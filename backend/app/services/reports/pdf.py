from __future__ import annotations

import io
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from tempfile import SpooledTemporaryFile
from textwrap import shorten, wrap
from typing import BinaryIO, Callable, Iterable, Iterator, Sequence
from uuid import UUID

from fastapi import HTTPException, status
from fpdf import FPDF
from pypdf import PdfReader as PypdfReader
from pypdf import PdfWriter as PypdfWriter
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from sqlalchemy import and_, case, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import to_ist
from app.models import (
    BaseUnit,
    Bill,
    BillItem,
    ExpenseEntry,
    InventoryCategory,
    InventoryItem,
    InventoryItemCategory,
    InventoryItemPurchaseRateHistory,
    InventoryMovement,
    InventoryMovementType,
    InventoryTransfer,
    Item,
    Payment,
    Purchaser,
    Retailer,
    RetailerPayment,
    RetailerSale,
    Shop,
    ShopInventoryAllocation,
    ShopRetailerAllocation,
    TransferShop,
)
from app.schemas.admin import (
    AdminReportDetailLevel,
    AdminReportSection,
    AnalyticsPeriod,
)
from app.services.report_blank_columns import _filter_empty_report_columns
from app.services.billing import bill_counts_toward_sales_clause
from app.services.retailer_sale_number import format_retailer_sale_bill_no
from app.services.tenant_query import list_organization_shops, resolve_organization_display_name

SECTION_ORDER: tuple[AdminReportSection, ...] = (
    "sales",
    "billing",
    "items",
    "inventory",
    "expenses",
    "transfers",
    "retailers",
    "purchase",
    "over_report",
)
SECTION_LABELS: dict[AdminReportSection, str] = {
    "sales": "Sales",
    "billing": "Billing",
    "items": "Items",
    "inventory": "Inventory",
    "expenses": "Expenses",
    "transfers": "Transfer Stock",
    "retailers": "Retailers",
    "purchase": "Purchase",
    "over_report": "Overall Report",
}
SUMMARY_BILL_ROWS = 25
SUMMARY_ITEM_ROWS = 50
SUMMARY_INVENTORY_ROWS = 100
FULL_QUERY_BATCH_SIZE = 500
KG_UNIT_SUFFIX = "(Kg/Unit)"
COUNT_SUFFIX = "Count"
_OVER_REPORT_HEADER_LABELS_EN = (
    "Date",
    "Inventory Item",
    "Old Stock",
    "Added Stock",
    "Total Available Stock",
    "Used Stock (Normal)",
    "Total Retailer Used Stock",
    "Transfer Stock",
    "Remaining Stock",
    "Purchase Rate",
    "Purchase Amount",
    "Billing Item",
    "Assumption (Normal)",
    "Total Retailer Assumption",
    "Sales (Normal)",
    "Total Retailer Sales",
    "Difference",
    "Assumption Amount (Normal)",
    "Total Retailer Assumption Amount",
    "Sales Amount (Normal)",
    "Total Retailer Billing Amount",
    "Difference Amount",
)
_OVER_REPORT_HEADER_LABELS_TA = (
    "தேதி",
    "சரக்கு பொருள்",
    "பழைய இருப்பு",
    "சேர்க்கப்பட்ட இருப்பு",
    "மொத்த இருப்பு",
    "பயன்படுத்தப்பட்ட இருப்பு (சாதாரண)",
    "மொத்த விற்பனையாளர் பயன்பாடு",
    "பரிமாற்ற இருப்பு",
    "மீதி இருப்பு",
    "கொள்முதல் விலை",
    "கொள்முதல் தொகை",
    "பில்லிங் பொருள்",
    "அனுமானம் (சாதாரண)",
    "மொத்த விற்பனையாளர் அனுமானம்",
    "விற்பனை (சாதாரண)",
    "மொத்த விற்பனையாளர் விற்பனை",
    "வித்தியாசம்",
    "அனுமான தொகை (சாதாரண)",
    "மொத்த விற்பனையாளர் அனுமான தொகை",
    "விற்பனை தொகை (சாதாரண)",
    "மொத்த விற்பனையாளர் பில்லிங் தொகை",
    "வித்தியாச தொகை",
)
_KG_UNIT_HEADER_INDICES = frozenset({12, 13, 14, 15, 16})
_OVER_REPORT_COLUMN_COUNT = 22


from app.schemas.admin import OverallReportRetailer


def get_over_report_sheet_config(
    use_tamil: bool, retailers: list[OverallReportRetailer] | None = None
) -> tuple[list[str], list[int], list[str], list[str], list[int], list[int]]:
    del retailers  # retailer-wise values are aggregated; no per-retailer PDF columns
    raw_labels = _OVER_REPORT_HEADER_LABELS_TA if use_tamil else _OVER_REPORT_HEADER_LABELS_EN

    headers: list[str] = []
    min_widths: list[int] = []
    aligns: list[str] = []
    h_aligns: list[str] = []

    base_min_widths = [
        46,
        58,
        72,
        72,
        72,
        76,
        72,
        68,
        68,
        52,
        58,
        62,
        58,
        72,
        58,
        72,
        56,
        64,
        76,
        64,
        80,
        64,
    ]
    base_aligns = ["left"] * _OVER_REPORT_COLUMN_COUNT

    part1_indices = list(range(11))
    part2_indices = [0, 1] + list(range(11, _OVER_REPORT_COLUMN_COUNT))

    def _add_col(
        label: str,
        min_width: int,
        align: str,
        h_align: str,
        *,
        force_kg: bool = False,
    ) -> None:
        if force_kg:
            headers.append(f"{label}\n{KG_UNIT_SUFFIX}")
        else:
            headers.append(label)
        min_widths.append(min_width)
        aligns.append(align)
        h_aligns.append(h_align)

    for i in range(_OVER_REPORT_COLUMN_COUNT):
        force_kg = i in _KG_UNIT_HEADER_INDICES
        _add_col(raw_labels[i], base_min_widths[i], base_aligns[i], "center", force_kg=force_kg)

    return headers, min_widths, aligns, h_aligns, part1_indices, part2_indices


def _over_report_sheet_headers(
    use_tamil: bool = False,
    retailers: list[OverallReportRetailer] | None = None,
) -> list[str]:
    headers, _, _, _, _, _ = get_over_report_sheet_config(use_tamil, retailers)
    return headers


OVER_REPORT_SHEET_HEADER_PADDING = 8
OVER_REPORT_SHEET_DATA_PADDING = 6
OVER_REPORT_SHEET_HEADER_FONT_SIZE_FPDF = 11.0
OVER_REPORT_SHEET_HEADER_FONT_SIZE_REPORTLAB = 10.0
OVER_REPORT_SHEET_DATA_FONT_SIZE_FPDF = 12.0
OVER_REPORT_SHEET_DATA_FONT_SIZE_REPORTLAB = 11.0


def _over_report_sheet_widths(
    headers: list[str],
    *,
    line_width: Callable[[str], float],
    available_width: float,
    padding: float = OVER_REPORT_SHEET_HEADER_PADDING,
    min_widths: Sequence[int],
    rows: list[list[str]] | None = None,
    data_line_width: Callable[[str], float] | None = None,
    data_padding: float = OVER_REPORT_SHEET_DATA_PADDING,
) -> list[int]:
    widths = [
        max(
            floor,
            int(max(line_width(line) for line in header.split("\n")) + padding * 2),
        )
        for header, floor in zip(headers, min_widths, strict=True)
    ]
    measure_data = data_line_width or line_width
    if rows:
        for index in range(len(headers)):
            for row in rows:
                if index >= len(row):
                    continue
                cell = str(row[index] or "")
                if not cell:
                    continue
                for line in cell.split("\n"):
                    widths[index] = max(
                        widths[index],
                        int(measure_data(line) + data_padding * 2),
                    )
    total = sum(widths)
    if total <= available_width:
        if total < available_width:
            slack = available_width - total
            widths = [width + int(slack * width / total) for width in widths]
        return widths

    scale = available_width / total
    scaled = [
        max(int(width * scale), floor) for width, floor in zip(widths, min_widths, strict=True)
    ]
    overflow = sum(scaled) - available_width
    if overflow > 0:
        for index in sorted(range(len(scaled)), key=scaled.__getitem__, reverse=True):
            if overflow <= 0:
                break
            reducible = scaled[index] - min_widths[index]
            cut = min(reducible, overflow)
            scaled[index] -= cut  # type: ignore
            overflow -= cut
    return scaled


def _reportlab_sheet_header_line_width(text: str) -> float:
    _, tamil_bold = _resolve_tamil_fonts()
    font = tamil_bold if _has_tamil_text(text) else "Helvetica-Bold"
    return pdfmetrics.stringWidth(text, font, OVER_REPORT_SHEET_HEADER_FONT_SIZE_REPORTLAB)


def _fpdf_sheet_header_line_width(pdf: FPDF, text: str) -> float:
    style = "B"
    font_size = OVER_REPORT_SHEET_HEADER_FONT_SIZE_FPDF
    if _has_tamil_text(text):
        pdf.set_font("NotoSansTamil", style=style, size=font_size)
    else:
        pdf.set_font("NotoSans", style=style, size=font_size)
    return pdf.get_string_width(text)


def _reportlab_sheet_data_line_width(text: str) -> float:
    regular, tamil_regular = _resolve_tamil_fonts()
    font = tamil_regular if _has_tamil_text(text) else "Helvetica"
    return pdfmetrics.stringWidth(text, font, OVER_REPORT_SHEET_DATA_FONT_SIZE_REPORTLAB)


def _fpdf_sheet_data_line_width(pdf: FPDF, text: str) -> float:
    if _has_tamil_text(text):
        pdf.set_font("NotoSansTamil", size=OVER_REPORT_SHEET_DATA_FONT_SIZE_FPDF)
    else:
        pdf.set_font("NotoSans", size=OVER_REPORT_SHEET_DATA_FONT_SIZE_FPDF)
    return pdf.get_string_width(text)


def _reportlab_over_report_sheet_widths(
    headers: list[str],
    available_width: float,
    min_widths: Sequence[int],
    rows: list[list[str]] | None = None,
) -> list[int]:
    return _over_report_sheet_widths(
        headers,
        line_width=_reportlab_sheet_header_line_width,
        available_width=available_width,
        min_widths=min_widths,
        rows=rows,
        data_line_width=_reportlab_sheet_data_line_width,
    )


def _fpdf_over_report_sheet_widths(
    pdf: FPDF,
    headers: list[str],
    min_widths: Sequence[int],
    rows: list[list[str]] | None = None,
) -> list[int]:
    available_width = pdf.w - pdf.l_margin - pdf.r_margin
    return _over_report_sheet_widths(
        headers,
        line_width=lambda text: _fpdf_sheet_header_line_width(pdf, text),
        available_width=available_width,
        rows=rows,
        data_line_width=lambda text: _fpdf_sheet_data_line_width(pdf, text),
        min_widths=min_widths,
    )


_REPORT_APP_DIR = Path(__file__).resolve().parent.parent.parent
_REPORT_FONTS_DIR = _REPORT_APP_DIR / "fonts"
_REPORT_ASSET_FONTS_DIR = _REPORT_APP_DIR / "assets" / "fonts"

TAMIL_FONT_REGULAR = "BillingReportNotoSansTamil"
TAMIL_FONT_BOLD = "BillingReportNotoSansTamilBold"
LATIN_FONT_REGULAR_PATHS = (
    _REPORT_FONTS_DIR / "custom_noto.ttf",
    Path("/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"),
)
LATIN_FONT_BOLD_PATHS = (
    _REPORT_FONTS_DIR / "custom_noto-semibold.ttf",
    _REPORT_FONTS_DIR / "custom_noto-extrabold.ttf",
    Path("/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"),
)
TAMIL_FONT_REGULAR_PATHS = (
    _REPORT_FONTS_DIR / "NotoSansTamil-Regular.ttf",
    _REPORT_ASSET_FONTS_DIR / "NotoSansTamil-Regular.ttf",
    _REPORT_FONTS_DIR / "NotoSansTamil.ttf",
    Path("/usr/share/fonts/truetype/noto/NotoSansTamil-Regular.ttf"),
    Path("/usr/share/fonts/truetype/noto/NotoSerifTamil-Regular.ttf"),
)
TAMIL_FONT_BOLD_PATHS = (
    _REPORT_ASSET_FONTS_DIR / "NotoSansTamil-Bold.ttf",
    Path("/usr/share/fonts/truetype/noto/NotoSansTamil-Bold.ttf"),
    Path("/usr/share/fonts/truetype/noto/NotoSerifTamil-Bold.ttf"),
)


@dataclass(frozen=True)
class AdminReportFile:
    file: BinaryIO
    filename: str


@dataclass(frozen=True)
class ReportContext:
    sections: list[AdminReportSection]
    detail_level: AdminReportDetailLevel
    period: AnalyticsPeriod
    start: datetime
    end: datetime
    shops: list[tuple[UUID, str]]
    shop_ids: tuple[UUID, ...]
    organization_id: UUID
    organization_name: str
    retailer_ids: tuple[UUID, ...] = ()
    purchaser_ids: tuple[UUID, ...] = ()

    @property
    def scoped_shop_ids(self) -> tuple[UUID, ...]:
        if self.shop_ids:
            return self.shop_ids
        return tuple(shop_id for shop_id, _ in self.shops)

    @property
    def scoped_retailer_ids(self) -> tuple[UUID, ...]:
        return self.retailer_ids

    @property
    def scoped_purchaser_ids(self) -> tuple[UUID, ...]:
        return self.purchaser_ids

    @property
    def branch_label(self) -> str:
        if not self.shops:
            return "No branches"
        if len(self.shops) == 1:
            return self.shops[0][1]
        if self.shop_ids:
            return f"{len(self.shops)} selected branches"
        return "All branches"

    @property
    def period_label(self) -> str:
        end_inclusive = self.end - timedelta(days=1)
        if self.start.date() == end_inclusive.date():
            return self.start.date().isoformat()
        return f"{self.start.date().isoformat()} to {end_inclusive.date().isoformat()}"


def _report_org_header(context: ReportContext) -> str:
    return context.organization_name.strip().upper() or "ORGANIZATION"


def _report_branch_header(context: ReportContext, shop_name: str | None = None) -> str:
    if shop_name and shop_name.strip():
        return shop_name.strip().upper()
    return context.branch_label.strip().upper()


async def _resolve_report_organization_name(
    db: AsyncSession,
    *,
    organization_id: UUID | None,
    shops: list[tuple[UUID, str]],
) -> str:
    org_id = organization_id
    if org_id is None and shops:
        org_id = await db.scalar(select(Shop.organization_id).where(Shop.id == shops[0][0]))
    return await resolve_organization_display_name(db, org_id)


@dataclass(frozen=True)
class TableState:
    headers: list[str]
    widths: list[int]
    alignments: list[str]
    bold_borders: bool = False


SoldItemCategoryKey = tuple[UUID, str, object]


class PdfReportWriter:
    # Keep content clear of footer band (line at y=34, label at y=22).
    FOOTER_RESERVED_PT = 72

    def __init__(self, output: BinaryIO) -> None:
        self._canvas = Canvas(output, pagesize=A4, pageCompression=0)
        self._font_regular = "Helvetica"
        self._font_bold = "Helvetica-Bold"
        self._tamil_font_regular, self._tamil_font_bold = _resolve_tamil_fonts()
        self._width, self._height = A4
        self._margin = 36
        self._bottom = self.FOOTER_RESERVED_PT
        self._y = self._height - self._margin
        self._current_table: TableState | None = None
        self._current_table_is_sheet = False
        self._table_row_index = 0
        self._page_has_content = False
        self._primary = (0.18, 0.24, 0.32)
        self._primary_soft = (0.91, 0.94, 0.97)
        self._section_fill = (0.96, 0.97, 0.98)
        self._note_fill = (1.0, 0.98, 0.93)
        self._row_alt_fill = (0.98, 0.99, 1.0)
        self._border = (0.82, 0.85, 0.89)
        self._text = (0.12, 0.15, 0.20)
        self._muted = (0.38, 0.43, 0.50)

    def save(self) -> None:
        self._draw_footer()
        self._canvas.save()

    def title(self, title: str, lines: Iterable[str]) -> None:
        self._current_table = None
        self._current_table_is_sheet = False
        self._page_has_content = True
        card_height = 112
        self._ensure_space(card_height + 18, repeat_table_header=False)
        self._page_has_content = True
        card_y = self._y - card_height
        self._set_fill(self._primary)
        self._canvas.roundRect(
            self._margin,
            card_y,
            self._available_width,
            card_height,
            10,
            stroke=0,
            fill=1,
        )
        self._set_fill((1, 1, 1))
        self._canvas.setFont(self._font_bold, 21)
        self._canvas.drawString(self._margin + 18, self._y - 34, title)
        self._canvas.setFont(self._font_regular, 9)
        self._canvas.drawString(self._margin + 18, self._y - 52, "Generated for admin reporting")

        meta_lines = list(lines)
        x_positions = [self._margin + 18, self._margin + 275]
        y = self._y - 78
        for index, line in enumerate(meta_lines):
            label, _, value = line.partition(":")
            x = x_positions[index % 2]
            if index > 0 and index % 2 == 0:
                y -= 19
            self._canvas.setFont(self._font_bold, 7)
            self._set_fill((0.78, 0.84, 0.91))
            self._canvas.drawString(x, y, _pdf_text(label.upper(), 26))
            self._canvas.setFont(self._font_regular, 8)
            self._set_fill((1, 1, 1))
            self._canvas.drawString(x, y - 11, _pdf_text(value.strip(), 44))
        self._y = card_y - 20

    def section(self, title: str) -> None:
        self._current_table = None
        self._current_table_is_sheet = False
        self._page_has_content = True
        self._ensure_space(44, repeat_table_header=False)
        self._page_has_content = True
        band_height = 30
        band_y = self._y - band_height
        self._set_fill(self._section_fill)
        self._set_stroke(self._border)
        self._canvas.roundRect(
            self._margin,
            band_y,
            self._available_width,
            band_height,
            7,
            stroke=1,
            fill=1,
        )
        self._set_fill(self._primary)
        self._canvas.roundRect(self._margin, band_y, 6, band_height, 3, stroke=0, fill=1)
        self._set_fill(self._text)
        self._canvas.setFont(self._font_bold, 13)
        self._canvas.drawString(self._margin + 16, band_y + 9, title)
        self._y = band_y - 12

    def note(self, text: str) -> None:
        self._current_table = None
        self._current_table_is_sheet = False
        self._page_has_content = True
        self._ensure_space(28, repeat_table_header=False)
        self._page_has_content = True
        box_height = 22
        box_y = self._y - box_height
        self._set_fill(self._note_fill)
        self._set_stroke((0.88, 0.80, 0.63))
        self._canvas.roundRect(
            self._margin,
            box_y,
            self._available_width,
            box_height,
            6,
            stroke=1,
            fill=1,
        )
        self._set_fill(self._muted)
        self._canvas.setFont(self._font_regular, 9)
        self._canvas.drawString(self._margin + 10, box_y + 7, _pdf_text(text, 128))
        self._y = box_y - 10

    def financial_summary(self, metrics: list[tuple[str, str]]) -> None:
        self._current_table = None
        self._current_table_is_sheet = False
        self._page_has_content = True

        block_height = len(metrics) * 16 + 10
        self._ensure_space(block_height, repeat_table_header=False)
        self._page_has_content = True

        y = self._y - 16
        self._set_fill(self._text)
        for label, value in metrics:
            self._canvas.setFont(self._font_bold, 9)
            self._canvas.drawString(self._width - 220, y, label)
            self._canvas.drawRightString(self._width - self._margin, y, value)
            y -= 16

        self._y = y - 4

    def split_financial_summary(
        self,
        left_title: str,
        left_metrics: list[tuple[str, str]],
        right_metrics: list[tuple[str, str]],
    ) -> None:
        self._current_table = None
        self._current_table_is_sheet = False
        self._page_has_content = True

        row_count = max(len(right_metrics), len(left_metrics) + 1)
        block_height = row_count * 16 + 10
        self._ensure_space(block_height, repeat_table_header=False)
        self._page_has_content = True

        left_x = self._margin
        left_value_x = self._margin + self._available_width * 0.42
        right_label_x = self._width - 220
        y = self._y - 16
        self._set_fill(self._text)

        for index in range(row_count):
            if index == 0 and left_title:
                self._canvas.setFont(self._font_bold, 9)
                self._canvas.drawString(left_x, y, left_title)
            elif index > 0 and index - 1 < len(left_metrics):
                label, value = left_metrics[index - 1]
                self._canvas.setFont(self._font_bold, 9)
                self._canvas.drawString(left_x, y, label)
                self._canvas.drawRightString(left_value_x, y, value)

            if index < len(right_metrics):
                label, value = right_metrics[index]
                self._canvas.setFont(self._font_bold, 9)
                self._canvas.drawString(right_label_x, y, label)
                self._canvas.drawRightString(self._width - self._margin, y, value)

            y -= 16

        self._y = y - 4

    def table(
        self,
        headers: list[str],
        rows: Iterable[Iterable[object]],
        widths: list[int],
        alignments: list[str] | None = None,
    ) -> int:
        row_count = 0
        self.table_header(headers, widths, alignments)
        for row in rows:
            self.table_row(row, widths, alignments)
            row_count += 1
        self._y -= 8
        self._current_table = None
        self._current_table_is_sheet = False
        return row_count

    def use_landscape_page(self) -> None:
        self._current_table = None
        self._current_table_is_sheet = False
        if self._page_has_content:
            self._draw_footer()
            self._canvas.showPage()
        self._canvas.setPageSize(landscape(A4))
        self._width, self._height = landscape(A4)
        self._margin = 18
        self._bottom = self.FOOTER_RESERVED_PT
        self._y = self._height - self._margin
        self._page_has_content = False

    def statement_header(self, company: str, branch: str, title: str, date_line: str) -> None:
        self._current_table = None
        self._current_table_is_sheet = False
        self._ensure_space(82, repeat_table_header=False)
        self._page_has_content = True
        lines = [
            (company, 16),
            (branch, 13),
            (title, 10),
            (date_line, 9),
        ]
        y = self._y - 18
        self._set_fill(self._text)
        for text, font_size in lines:
            self._canvas.setFont(self._font_bold, font_size)
            self._canvas.drawCentredString(self._width / 2, y, _pdf_text(text, 120))
            y -= font_size + 6
        self._y = y - 8

    def right_aligned_meta(self, lines: list[str], *, font_size: int = 9) -> None:
        """Draw right-aligned meta lines above the next table block."""
        if not lines:
            return
        self._current_table = None
        self._current_table_is_sheet = False
        line_height = font_size + 4
        block_height = len(lines) * line_height + 8
        self._ensure_space(block_height, repeat_table_header=False)
        self._page_has_content = True
        y = self._y - font_size
        self._set_fill(self._text)
        self._canvas.setFont(self._font_bold, font_size)
        right_x = self._width - self._margin
        for line in lines:
            self._canvas.drawRightString(right_x, y, _pdf_text(line, 90))
            y -= line_height
        self._y = y - 4

    def sheet_table(
        self,
        headers: list[str],
        rows: Iterable[Iterable[object]],
        widths: list[int],
        alignments: list[str],
        *,
        bold_borders: bool = False,
    ) -> int:
        state = TableState(
            headers=headers,
            widths=widths,
            alignments=alignments,
            bold_borders=bold_borders,
        )
        self._current_table = state
        self._current_table_is_sheet = True
        self._table_row_index = 0
        self._draw_sheet_table_header(state)
        row_count = 0
        for row in rows:
            self._draw_sheet_table_row(row, state)
            row_count += 1
        self._y -= 8
        self._current_table = None
        self._current_table_is_sheet = False
        return row_count

    def table_header(
        self,
        headers: list[str],
        widths: list[int],
        alignments: list[str] | None = None,
    ) -> None:
        state = TableState(
            headers=headers, widths=widths, alignments=alignments or ["left"] * len(headers)
        )
        self._current_table = state
        self._current_table_is_sheet = False
        self._table_row_index = 0
        self._draw_table_header(state)

    def table_row(
        self,
        row: Iterable[object],
        widths: list[int],
        alignments: list[str] | None = None,
    ) -> None:
        self._page_has_content = True
        font_size = 7
        line_height = 8
        padding = 5
        row_values = list(row)
        cell_lines = [
            _pdf_text_lines(
                _format_cell(value),
                max(6, int((width - padding * 2) / 3.7)),
            )
            for value, width in zip(row_values, widths, strict=True)
        ]
        max_lines = max((len(lines) for lines in cell_lines), default=1)
        row_height = max(18, padding * 2 + font_size + line_height * (max_lines - 1))
        self._ensure_space(row_height, repeat_table_header=True)
        self._page_has_content = True
        row_y = self._y - row_height
        fill = self._row_alt_fill if self._table_row_index % 2 else (1, 1, 1)
        self._set_fill(fill)
        self._set_stroke((0.90, 0.92, 0.94))
        self._canvas.rect(self._margin, row_y, sum(widths), row_height, stroke=1, fill=1)
        self._set_fill(self._text)
        x = self._margin
        if alignments is not None:
            row_alignments = alignments
        elif self._current_table is not None:
            row_alignments = self._current_table.alignments
        else:
            row_alignments = ["left"] * len(widths)
        for lines, width, alignment in zip(cell_lines, widths, row_alignments, strict=True):
            text_y = row_y + row_height - padding - font_size
            for line in lines:
                self._draw_cell_line(line, x, text_y, width, alignment, font_size=font_size)
                text_y -= line_height
            x += width
        self._y -= row_height
        self._table_row_index += 1

    @property
    def _available_width(self) -> float:
        return self._width - self._margin * 2

    def _draw_table_header(self, state: TableState) -> None:
        self._page_has_content = True
        header_height = 22
        self._ensure_space(header_height, repeat_table_header=False)
        self._page_has_content = True
        header_y = self._y - header_height
        self._set_fill(self._primary)
        self._set_stroke(self._primary)
        self._canvas.roundRect(
            self._margin, header_y, sum(state.widths), header_height, 5, stroke=1, fill=1
        )
        self._set_fill((1, 1, 1))
        self._canvas.setFont(self._font_bold, 7)
        x = self._margin
        for header, width, alignment in zip(
            state.headers, state.widths, state.alignments, strict=True
        ):
            self._draw_cell_text(
                header,
                x,
                header_y + 8,
                width,
                alignment,
                font_size=7,
                bold=True,
                max_ratio=4.2,
            )
            x += width
        self._y -= header_height

    def _sheet_border_style(self, *, bold: bool) -> tuple[tuple[float, float, float], float]:
        if bold:
            return (0.12, 0.12, 0.12), 1.4
        return (0.78, 0.78, 0.78), 0.8

    def _draw_sheet_table_header(self, state: TableState) -> None:
        font_size = 5.4
        line_height = 6.2
        padding = 3
        cell_lines = [header.split("\n") if header else [""] for header in state.headers]
        max_lines = max((len(lines) for lines in cell_lines), default=1)
        header_height = max(26, padding * 2 + font_size + line_height * (max_lines - 1))
        self._ensure_space(int(header_height), repeat_table_header=False)
        self._page_has_content = True
        header_y = self._y - header_height
        header_stroke, header_line_width = self._sheet_border_style(bold=state.bold_borders)
        self._set_fill((0.90, 0.90, 0.90))
        self._set_stroke(header_stroke)
        self._canvas.setLineWidth(header_line_width)
        self._canvas.rect(
            self._margin, header_y, sum(state.widths), header_height, stroke=1, fill=1
        )
        x = self._margin
        self._set_fill(self._text)
        for lines, width, alignment in zip(cell_lines, state.widths, state.alignments, strict=True):
            self._set_stroke(header_stroke)
            self._canvas.setLineWidth(header_line_width)
            self._canvas.rect(x, header_y, width, header_height, stroke=1, fill=0)
            block_height = font_size + line_height * max(0, len(lines) - 1)
            text_y = header_y + (header_height + block_height) / 2 - font_size
            for line in lines:
                self._draw_cell_line(
                    line, x, text_y, width, "center", font_size=font_size, bold=True
                )
                text_y -= line_height
            x += width
        self._y -= header_height

    def _draw_sheet_table_row(self, row: Iterable[object], state: TableState) -> None:
        font_size = 5.6
        line_height = 6.4
        padding = 3
        row_values = list(row)
        cell_lines = [
            _reportlab_sheet_cell_lines(_format_cell(value), width - padding * 2)
            for value, width in zip(row_values, state.widths, strict=True)
        ]
        max_lines = max((len(lines) for lines in cell_lines), default=1)
        row_height = max(20, padding * 2 + font_size + line_height * (max_lines - 1))
        self._ensure_space(int(row_height), repeat_table_header=True)
        self._page_has_content = True
        row_y = self._y - row_height
        fill = (0.98, 0.98, 0.98) if self._table_row_index % 2 else (1, 1, 1)
        row_stroke, row_line_width = self._sheet_border_style(bold=state.bold_borders)
        self._set_fill(fill)
        self._set_stroke(row_stroke)
        self._canvas.setLineWidth(row_line_width)
        self._canvas.rect(self._margin, row_y, sum(state.widths), row_height, stroke=1, fill=1)
        x = self._margin
        self._set_fill(self._text)
        for lines, width, alignment in zip(cell_lines, state.widths, state.alignments, strict=True):
            self._set_stroke(row_stroke)
            self._canvas.setLineWidth(row_line_width)
            self._canvas.rect(x, row_y, width, row_height, stroke=1, fill=0)
            text_y = row_y + row_height - padding - font_size
            for line in lines:
                self._draw_cell_line(line, x, text_y, width, alignment, font_size=font_size)
                text_y -= line_height
            x += width
        self._y -= row_height
        self._table_row_index += 1

    def _draw_cell_text(
        self,
        value: str,
        x: float,
        y: float,
        width: float,
        alignment: str,
        *,
        font_size: int,
        bold: bool = False,
        max_ratio: float = 3.7,
    ) -> None:
        padding = 5
        text = _pdf_text(value, max(6, int((width - padding * 2) / max_ratio)))
        self._draw_cell_line(text, x, y, width, alignment, font_size=font_size, bold=bold)

    def _draw_cell_line(
        self,
        text: str,
        x: float,
        y: float,
        width: float,
        alignment: str,
        *,
        font_size: int,
        bold: bool = False,
    ) -> None:
        padding = 5
        self._set_text_font(text, font_size, bold=bold)
        if alignment == "right":
            self._canvas.drawRightString(x + width - padding, y, text)
        elif alignment == "center":
            self._canvas.drawCentredString(x + width / 2, y, text)
        else:
            self._canvas.drawString(x + padding, y, text)

    def _ensure_space(self, height: int, *, repeat_table_header: bool = True) -> None:
        if self._y - height >= self._bottom:
            return
        self._new_page()
        if repeat_table_header and self._current_table is not None:
            if self._current_table_is_sheet:
                self._draw_sheet_table_header(self._current_table)
            else:
                self._draw_table_header(self._current_table)

    def _new_page(self) -> None:
        self._draw_footer()
        self._canvas.showPage()
        self._y = self._height - self._margin
        self._page_has_content = False

    def _draw_footer(self) -> None:
        self._set_stroke(self._border)
        self._canvas.line(self._margin, 34, self._width - self._margin, 34)
        self._canvas.setFont(self._font_regular, 7)
        self._set_fill(self._muted)
        self._canvas.drawString(self._margin, 22, "Billing System Admin Report")
        self._canvas.drawRightString(
            self._width - self._margin,
            22,
            f"Page {self._canvas.getPageNumber()}",
        )

    def _set_fill(self, rgb: tuple[float, float, float]) -> None:
        self._canvas.setFillColorRGB(*rgb)

    def _set_stroke(self, rgb: tuple[float, float, float]) -> None:
        self._canvas.setStrokeColorRGB(*rgb)

    def _set_text_font(self, text: str, font_size: int, *, bold: bool = False) -> None:
        if _has_tamil_text(text):
            self._canvas.setFont(
                self._tamil_font_bold if bold else self._tamil_font_regular, font_size
            )
            return
        self._canvas.setFont(self._font_bold if bold else self._font_regular, font_size)


def iter_admin_report_file(report_file: BinaryIO, chunk_size: int = 64 * 1024) -> Iterator[bytes]:
    try:
        while True:
            chunk = report_file.read(chunk_size)
            if not chunk:
                break
            yield chunk
    finally:
        report_file.close()


def _report_filename(context: ReportContext) -> str:
    period_start = context.start.date()
    period_end = (context.end - timedelta(days=1)).date()
    start_text = period_start.strftime("%d-%m-%Y")
    if period_start == period_end:
        return f"Admin-Report-{start_text}.pdf"
    return f"Admin-Report-{start_text} to {period_end.strftime('%d-%m-%Y')}.pdf"


def _format_cell(value: object) -> str:
    if isinstance(value, Decimal):
        return _quantity(value)
    if isinstance(value, datetime):
        return _datetime_text(value)
    if value is None:
        return ""
    # Preserve intentional newlines (e.g. retailer name + shop name).
    return "\n".join(
        _normalize_report_text(segment) for segment in str(value).replace("\r", "").split("\n")
    )


def _resolve_font_file(*paths: Path) -> Path:
    for path in paths:
        if path.is_file():
            return path
    raise FileNotFoundError(
        f"No report font file found in: {', '.join(str(path) for path in paths)}"
    )


def _resolve_tamil_fonts() -> tuple[str, str]:
    regular = _register_pdf_font(TAMIL_FONT_REGULAR, TAMIL_FONT_REGULAR_PATHS)
    bold = _register_pdf_font(TAMIL_FONT_BOLD, TAMIL_FONT_BOLD_PATHS)
    return regular or "Helvetica", bold or regular or "Helvetica-Bold"


def _register_fpdf_fonts(pdf: FPDF) -> None:
    pdf.add_font("NotoSans", fname=str(_resolve_font_file(*LATIN_FONT_REGULAR_PATHS)))
    pdf.add_font("NotoSans", style="B", fname=str(_resolve_font_file(*LATIN_FONT_BOLD_PATHS)))
    pdf.add_font("NotoSansTamil", fname=str(_resolve_font_file(*TAMIL_FONT_REGULAR_PATHS)))
    pdf.add_font("NotoSansTamil", style="B", fname=str(_resolve_font_file(*TAMIL_FONT_BOLD_PATHS)))
    pdf.set_font("NotoSans")
    pdf.set_fallback_fonts(["NotoSansTamil"])


def _register_pdf_font(name: str, paths: tuple[Path, ...]) -> str | None:
    if name in pdfmetrics.getRegisteredFontNames():
        return name
    for path in paths:
        if not path.exists():
            continue
        try:
            pdfmetrics.registerFont(TTFont(name, str(path)))
            return name
        except Exception:
            continue
    return None


def _has_tamil_text(value: str) -> bool:
    return any("\u0b80" <= character <= "\u0bff" for character in value)


def _reportlab_sheet_cell_lines(text: str, inner_width: float) -> list[str]:
    if not text:
        return [""]
    lines: list[str] = []
    for segment in text.split("\n"):
        if not segment:
            lines.append("")
            continue
        if _reportlab_sheet_data_line_width(segment) <= inner_width:
            lines.append(segment)
            continue
        wrap_width = max(4, int(inner_width / 3.2))
        lines.extend(_pdf_text_lines(segment, wrap_width))
    return lines or [""]


def _pdf_text(value: str, width: int) -> str:
    text = _normalize_report_text(value)
    return shorten(text, width=max(4, width), placeholder="...")


def _pdf_text_lines(value: str, width: int) -> list[str]:
    raw = value.replace("\r", "").strip()
    if not raw:
        return [""]
    lines: list[str] = []
    for segment in raw.split("\n"):
        text = _normalize_report_text(segment)
        if not text:
            lines.append("")
            continue
        wrapped = wrap(
            text,
            width=max(4, width),
            break_long_words=False,
            break_on_hyphens=False,
            drop_whitespace=True,
        )
        lines.extend(wrapped or [text])
    return lines or [""]


def _decimal(value: object) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def _money(value: object) -> str:
    return f"Rs. {_money_amount(value)}"


def _money_amount(value: object) -> str:
    """Currency amount without Rs prefix (for tables that put Rs in the header)."""
    return f"{_decimal(value).quantize(Decimal('0.01'))}"


def _over_report_money(value: object | None) -> str:
    if value is None:
        return ""
    amount = _decimal(value).quantize(Decimal("0.01"))
    if amount == 0:
        return "-"
    return f"₹{amount}"


def _over_report_quantity_with_unit(value: object, unit: object) -> str:
    if _decimal(value) == 0:
        return "-"
    return _quantity_with_unit(value, unit)


def _unit_value(unit: object) -> str:
    value = str(getattr(unit, "value", unit)).lower()
    if value == BaseUnit.KG.value:
        return "Kg"
    if value == BaseUnit.UNIT.value:
        return "Unit"
    return _normalize_report_text(str(getattr(unit, "value", unit)))


def _quantity_with_unit(value: object, unit: object) -> str:
    return f"{_quantity(value)} {_unit_value(unit)}"


def _normalize_report_text(value: str) -> str:
    text = value.replace("\r", " ").replace("\u00a0", " ")
    return re.sub(r"\s+", " ", text).strip()


def _quantity(value: object) -> str:
    quantity = _decimal(value).quantize(Decimal("0.001"))
    return f"{quantity:f}".rstrip("0").rstrip(".") or "0"


def _datetime_text(value: datetime | None) -> str:
    return to_ist(value).strftime("%Y-%m-%d %H:%M") if value is not None else ""


def _date_text(value: date) -> str:
    return value.strftime("%d/%m/%Y")


def _ist_date_text(value: datetime | None) -> str:
    return to_ist(value).strftime("%d/%m/%Y") if value is not None else ""


def _bill_filters(context: ReportContext) -> list[object]:
    filters: list[object] = [
        Bill.created_at >= context.start,
        Bill.created_at < context.end,
        bill_counts_toward_sales_clause(),
    ]
    scoped_shop_ids = context.scoped_shop_ids
    if scoped_shop_ids:
        filters.append(Bill.shop_id.in_(scoped_shop_ids))
    else:
        filters.append(Bill.id.is_(None))
    return filters


def _apply_shop_scope(query, context: ReportContext):
    scoped_shop_ids = context.scoped_shop_ids
    if not scoped_shop_ids:
        return query.where(Shop.id.is_(None))
    return query.where(Shop.id.in_(scoped_shop_ids))


def _inventory_totals_subquery(context: ReportContext, *, period_only: bool):
    filters = []
    scoped_shop_ids = context.scoped_shop_ids
    if scoped_shop_ids:
        filters.append(InventoryMovement.shop_id.in_(scoped_shop_ids))
    else:
        filters.append(InventoryMovement.id.is_(None))
    if period_only:
        filters.extend(
            [
                InventoryMovement.occurred_at >= context.start,
                InventoryMovement.occurred_at < context.end,
            ]
        )
    added_quantity = func.coalesce(
        func.sum(
            case(
                (
                    InventoryMovement.movement_type == InventoryMovementType.ADD,
                    InventoryMovement.quantity,
                ),
                else_=0,
            )
        ),
        0,
    ).label("added_quantity")
    used_quantity = func.coalesce(
        func.sum(
            case(
                (
                    InventoryMovement.movement_type == InventoryMovementType.USE,
                    InventoryMovement.quantity,
                ),
                else_=0,
            )
        ),
        0,
    ).label("used_quantity")
    query = (
        select(
            InventoryMovement.shop_id,
            InventoryMovement.inventory_item_id,
            added_quantity,
            used_quantity,
        )
        .where(*filters)
        .group_by(InventoryMovement.shop_id, InventoryMovement.inventory_item_id)
    )
    return query.subquery()


async def _inventory_category_labels_by_item_id(
    db: AsyncSession,
    item_ids: list[UUID],
) -> dict[UUID, str]:
    unique_item_ids = list(dict.fromkeys(item_ids))
    if not unique_item_ids:
        return {}
    rows = (
        await db.execute(
            select(
                InventoryItemCategory.inventory_item_id,
                InventoryCategory.name,
            )
            .join(InventoryCategory, InventoryCategory.id == InventoryItemCategory.category_id)
            .where(InventoryItemCategory.inventory_item_id.in_(unique_item_ids))
            .order_by(
                InventoryItemCategory.inventory_item_id,
                func.lower(InventoryCategory.name),
                InventoryCategory.id,
            )
        )
    ).all()
    names_by_item_id: dict[UUID, list[str]] = {}
    for row in rows:
        names_by_item_id.setdefault(row.inventory_item_id, []).append(row.name)
    return {item_id: ", ".join(names) for item_id, names in names_by_item_id.items()}


async def generate_admin_report_pdf(
    db: AsyncSession,
    *,
    sections: list[AdminReportSection],
    detail_level: AdminReportDetailLevel = "summary",
    period: AnalyticsPeriod = "date",
    reference_date: date | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
    shop_ids: list[UUID] | None = None,
    retailer_ids: list[UUID] | None = None,
    purchaser_ids: list[UUID] | None = None,
    organization_id: UUID | None = None,
    language: str = "en",
) -> AdminReportFile:
    context = await _build_report_context(
        db,
        sections=sections,
        detail_level=detail_level,
        period=period,
        reference_date=reference_date,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        shop_ids=shop_ids,
        retailer_ids=retailer_ids,
        purchaser_ids=purchaser_ids,
        organization_id=organization_id,
    )

    fpdf_only_sections = {"retailers", "transfers", "purchase"}
    non_over_sections = [s for s in context.sections if s != "over_report"]
    has_over_report = "over_report" in context.sections
    has_retailers_report = "retailers" in context.sections
    has_transfers_report = "transfers" in context.sections
    has_purchase_report = "purchase" in context.sections
    reportlab_sections = [s for s in non_over_sections if s not in fpdf_only_sections]
    has_any_fpdf = has_over_report or has_retailers_report or has_transfers_report or has_purchase_report

    # ── Step 1: ReportLab sections (Latin-first; no Tamil-heavy tables) ──
    rl_bytes: bytes | None = None
    if reportlab_sections or not has_any_fpdf:
        rl_output = io.BytesIO()
        writer = PdfReportWriter(rl_output)
        non_over_context = ReportContext(
            sections=reportlab_sections or context.sections,
            detail_level=context.detail_level,
            period=context.period,
            start=context.start,
            end=context.end,
            shops=context.shops,
            shop_ids=context.shop_ids,
            organization_id=context.organization_id,
            organization_name=context.organization_name,
            retailer_ids=context.retailer_ids,
            purchaser_ids=context.purchaser_ids,
        )
        if reportlab_sections:
            for section in reportlab_sections:
                if section == "sales":
                    await _write_sales_section(db, writer, non_over_context)
                elif section == "billing":
                    await _write_billing_section(db, writer, non_over_context)
                elif section == "items":
                    await _write_items_section(db, writer, non_over_context)
                elif section == "inventory":
                    await _write_inventory_section(db, writer, non_over_context)
                elif section == "expenses":
                    await _write_expenses_section(db, writer, non_over_context)
        writer.save()
        rl_bytes = rl_output.getvalue()

    # ── Step 2: Tamil-safe FPDF2 sections ──
    retailers_bytes: bytes | None = None
    if has_retailers_report:
        retailers_bytes = await _generate_retailers_fpdf_pdf(db, context, language=language)

    transfers_bytes: bytes | None = None
    if has_transfers_report:
        transfers_bytes = await _generate_transfers_fpdf_pdf(db, context, language=language)

    purchase_bytes: bytes | None = None
    if has_purchase_report:
        purchase_bytes = await _generate_purchase_fpdf_pdf(db, context, language=language)

    # ── Step 3: Overall report with FPDF2 (Tamil-safe) ──
    fpdf_bytes: bytes | None = None
    if has_over_report:
        from app.services.reports.queries import _generate_over_report_fpdf_pdf

        fpdf_bytes = await _generate_over_report_fpdf_pdf(db, context, language=language)

    # ── Step 4: Merge with pypdf ──
    output = SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b")
    merger = PypdfWriter()
    if rl_bytes:
        merger.append(PypdfReader(io.BytesIO(rl_bytes)))
    if transfers_bytes:
        merger.append(PypdfReader(io.BytesIO(transfers_bytes)))
    if purchase_bytes:
        merger.append(PypdfReader(io.BytesIO(purchase_bytes)))
    if retailers_bytes:
        merger.append(PypdfReader(io.BytesIO(retailers_bytes)))
    if fpdf_bytes:
        merger.append(PypdfReader(io.BytesIO(fpdf_bytes)))
    merger.write(output)
    output.seek(0)
    return AdminReportFile(file=output, filename=_report_filename(context))


async def _build_report_context(
    db: AsyncSession,
    *,
    sections: list[AdminReportSection],
    detail_level: AdminReportDetailLevel,
    period: AnalyticsPeriod,
    reference_date: date | None,
    range_start_date: date | None,
    range_end_date: date | None,
    shop_ids: list[UUID] | None,
    retailer_ids: list[UUID] | None = None,
    purchaser_ids: list[UUID] | None = None,
    organization_id: UUID | None = None,
) -> ReportContext:
    if organization_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization context is required for reports",
        )

    invalid_sections = [section for section in sections if section not in SECTION_LABELS]
    if not sections or invalid_sections:
        allowed = ", ".join(SECTION_ORDER)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"sections must contain at least one of: {allowed}.",
        )
    if detail_level not in {"summary", "full"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="detail_level must be summary or full.",
        )

    from app.services.admin.catalogue import _get_period_bounds

    start, end = _get_period_bounds(period, reference_date, range_start_date, range_end_date)
    unique_shop_ids = tuple(dict.fromkeys(shop_ids or []))
    unique_retailer_ids = tuple(dict.fromkeys(retailer_ids or []))
    unique_purchaser_ids = tuple(dict.fromkeys(purchaser_ids or []))
    shops = await list_organization_shops(
        db,
        organization_id,
        shop_ids=list(unique_shop_ids) if unique_shop_ids else None,
    )

    ordered_sections = [section for section in SECTION_ORDER if section in set(sections)]
    organization_name = await _resolve_report_organization_name(
        db, organization_id=organization_id, shops=shops
    )
    return ReportContext(
        sections=ordered_sections,
        detail_level=detail_level,
        period=period,
        start=start,
        end=end,
        shops=shops,
        shop_ids=unique_shop_ids,
        organization_id=organization_id,
        organization_name=organization_name,
        retailer_ids=unique_retailer_ids,
        purchaser_ids=unique_purchaser_ids,
    )


async def _write_sales_section(
    db: AsyncSession,
    writer: PdfReportWriter,
    context: ReportContext,
) -> None:
    period_start = context.start.date()
    period_end = (context.end - timedelta(days=1)).date()
    if period_start == period_end:
        date_line = f"Date: {_date_text(period_start)}"
    else:
        date_line = f"Date: {_date_text(period_start)} To {_date_text(period_end)}"

    branch_label = _report_branch_header(context)
    writer.statement_header(
        _report_org_header(context),
        branch_label,
        "Sales Report",
        date_line,
    )

    filters = _bill_filters(context)
    query = (
        select(
            Shop.name.label("shop_name"),
            func.count(distinct(Bill.id)).label("bill_count"),
            func.coalesce(func.sum(Bill.total_amount), 0).label("total_sales"),
            func.coalesce(func.sum(Payment.cash_amount), 0).label("cash_total"),
            func.coalesce(func.sum(Payment.upi_amount), 0).label("upi_total"),
        )
        .outerjoin(Bill, and_(Bill.shop_id == Shop.id, *filters))
        .outerjoin(Payment, Payment.bill_id == Bill.id)
        .group_by(Shop.id)
        .order_by(Shop.name)
    )
    query = _apply_shop_scope(query, context)
    rows = (await db.execute(query)).all()
    total_revenue = sum((_decimal(row.total_sales) for row in rows), Decimal("0"))
    total_cash = sum((_decimal(row.cash_total) for row in rows), Decimal("0"))
    total_upi = sum((_decimal(row.upi_total) for row in rows), Decimal("0"))
    total_bills = sum((int(row.bill_count or 0) for row in rows))

    writer.table(
        ["Branch", "Bills", "Revenue", "Cash", "UPI"],
        (
            [
                row.shop_name,
                int(row.bill_count or 0),
                _money(row.total_sales),
                _money(row.cash_total),
                _money(row.upi_total),
            ]
            for row in rows
        ),
        [195, 58, 90, 90, 90],
        ["left", "right", "right", "right", "right"],
    )

    writer.financial_summary(
        [
            ("Total Bills", str(total_bills)),
            ("Total Revenue", _money(total_revenue)),
            ("Total Cash", _money(total_cash)),
            ("Total UPI", _money(total_upi)),
        ]
    )


async def _write_billing_section(
    db: AsyncSession,
    writer: PdfReportWriter,
    context: ReportContext,
) -> None:
    period_start = context.start.date()
    period_end = (context.end - timedelta(days=1)).date()
    if period_start == period_end:
        date_line = f"Date: {_date_text(period_start)}"
    else:
        date_line = f"Date: {_date_text(period_start)} To {_date_text(period_end)}"

    branch_label = _report_branch_header(context)
    writer.statement_header(
        _report_org_header(context),
        branch_label,
        "Billing Report",
        date_line,
    )

    filters = _bill_filters(context)
    stats = (
        await db.execute(
            select(
                func.count(distinct(Bill.id)).label("bill_count"),
                func.coalesce(func.sum(Bill.total_amount), 0).label("total_sales"),
                func.coalesce(func.sum(Payment.cash_amount), 0).label("cash_total"),
                func.coalesce(func.sum(Payment.upi_amount), 0).label("upi_total"),
            )
            .select_from(Bill)
            .outerjoin(Payment, Payment.bill_id == Bill.id)
            .where(*filters)
        )
    ).one()
    max_rows = SUMMARY_BILL_ROWS if context.detail_level == "summary" else None
    writer.note(
        "Rows shown: "
        f"{min(int(stats.bill_count or 0), max_rows or int(stats.bill_count or 0))} "
        f"of {int(stats.bill_count or 0)} bills. "
        f"Total: {_money(stats.total_sales)}; Cash: {_money(stats.cash_total)}; UPI: {_money(stats.upi_total)}."
    )
    writer.table_header(
        ["Bill No", "Branch", "Date", "Total", "Cash", "UPI", "Status"],
        [74, 115, 108, 62, 62, 62, 40],
        ["left", "left", "left", "right", "right", "right", "center"],
    )

    row_count = 0
    cursor_created_at: datetime | None = None
    cursor_id: UUID | None = None
    remaining = max_rows
    while remaining is None or remaining > 0:
        limit = (
            FULL_QUERY_BATCH_SIZE if remaining is None else min(FULL_QUERY_BATCH_SIZE, remaining)
        )
        page_filters = list(filters)
        if cursor_created_at is not None and cursor_id is not None:
            page_filters.append(
                or_(
                    Bill.created_at < cursor_created_at,
                    and_(Bill.created_at == cursor_created_at, Bill.id < cursor_id),
                )
            )
        result = await db.execute(
            select(
                Bill.id,
                Bill.bill_no,
                Bill.created_at,
                Bill.total_amount,
                Bill.status,
                Shop.name.label("shop_name"),
                Payment.cash_amount,
                Payment.upi_amount,
            )
            .join(Shop, Shop.id == Bill.shop_id)
            .outerjoin(Payment, Payment.bill_id == Bill.id)
            .where(*page_filters)
            .order_by(Bill.created_at.desc(), Bill.id.desc())
            .limit(limit)
        )
        page = result.all()
        if not page:
            break
        for row in page:
            writer.table_row(
                [
                    row.bill_no,
                    row.shop_name,
                    _datetime_text(row.created_at),
                    _money(row.total_amount),
                    _money(row.cash_amount),
                    _money(row.upi_amount),
                    getattr(row.status, "value", row.status),
                ],
                [74, 115, 108, 62, 62, 62, 40],
                ["left", "left", "left", "right", "right", "right", "center"],
            )
            row_count += 1
        cursor_created_at = page[-1].created_at
        cursor_id = page[-1].id
        if remaining is not None:
            remaining -= len(page)
        if len(page) < limit:
            break

    writer.financial_summary(
        [
            ("Total Bills", str(int(stats.bill_count or 0))),
            ("Total Amount", _money(stats.total_sales)),
            ("Cash", _money(stats.cash_total)),
            ("UPI", _money(stats.upi_total)),
        ]
    )


async def _write_items_section(
    db: AsyncSession,
    writer: PdfReportWriter,
    context: ReportContext,
) -> None:
    writer.section("Items")
    filters = _bill_filters(context)
    max_rows = SUMMARY_ITEM_ROWS if context.detail_level == "summary" else None
    item_name = func.coalesce(Item.name, "Unknown item")
    item_unit = func.coalesce(Item.base_unit, BillItem.item_base_unit, BillItem.unit)
    item_amount = func.coalesce(func.sum(BillItem.line_total), 0)
    query = (
        select(
            Bill.shop_id,
            Shop.name.label("shop_name"),
            item_name.label("item_name"),
            item_unit.label("unit"),
            func.coalesce(func.sum(BillItem.quantity), 0).label("quantity_sold"),
            item_amount.label("total_amount"),
            func.count(distinct(BillItem.bill_id)).label("bill_count"),
        )
        .select_from(BillItem)
        .join(Bill, Bill.id == BillItem.bill_id)
        .join(Shop, Shop.id == Bill.shop_id)
        .outerjoin(Item, Item.id == BillItem.item_id)
        .where(*filters)
        .group_by(
            Bill.shop_id,
            Shop.name,
            item_name,
            item_unit,
        )
        .order_by(Shop.name, item_amount.desc(), item_name)
    )
    if max_rows is not None:
        query = query.limit(max_rows)
    rows = (await db.execute(query)).all()
    category_labels = await _sold_item_category_labels_by_key(
        db,
        context,
        {(row.shop_id, row.item_name, row.unit) for row in rows},
    )
    writer.note(
        f"Rows shown: {len(rows)}"
        + (
            " top sold item row(s). Items are grouped by current item name."
            if context.detail_level == "summary"
            else " sold item row(s). Items are grouped by current item name."
        )
    )
    writer.table(
        ["Branch", "Category", "Item", "Qty", "Unit", "Amount", "Bills"],
        (
            [
                row.shop_name,
                category_labels.get((row.shop_id, row.item_name, row.unit), "Uncategorized"),
                row.item_name,
                _quantity(row.quantity_sold),
                _unit_value(row.unit),
                _money(row.total_amount),
                int(row.bill_count or 0),
            ]
            for row in rows
        ),
        [78, 82, 132, 54, 40, 70, 40],
        ["left", "left", "left", "right", "center", "right", "right"],
    )


async def _sold_item_category_labels_by_key(
    db: AsyncSession,
    context: ReportContext,
    keys: set[SoldItemCategoryKey],
) -> dict[SoldItemCategoryKey, str]:
    if not keys:
        return {}

    item_name = func.coalesce(Item.name, "Unknown item")
    item_unit = func.coalesce(Item.base_unit, BillItem.item_base_unit, BillItem.unit)
    item_category = func.coalesce(func.nullif(func.trim(Item.category), ""), "Uncategorized")
    shop_ids = {shop_id for shop_id, _name, _unit in keys}
    item_names = {name for _shop_id, name, _unit in keys}
    rows = (
        await db.execute(
            select(
                Bill.shop_id,
                item_name.label("item_name"),
                item_unit.label("unit"),
                item_category.label("category"),
            )
            .select_from(BillItem)
            .join(Bill, Bill.id == BillItem.bill_id)
            .outerjoin(Item, Item.id == BillItem.item_id)
            .where(
                *_bill_filters(context),
                Bill.shop_id.in_(list(shop_ids)),
                item_name.in_(list(item_names)),
            )
            .group_by(Bill.shop_id, item_name, item_unit, item_category)
            .order_by(Bill.shop_id, item_name, item_category)
        )
    ).all()
    category_names_by_key: dict[SoldItemCategoryKey, set[str]] = {}
    for row in rows:
        key = (row.shop_id, row.item_name, row.unit)
        if key in keys:
            category_names_by_key.setdefault(key, set()).add(row.category)
    return {
        key: ", ".join(sorted(category_names, key=str.lower))
        for key, category_names in category_names_by_key.items()
    }


async def _write_inventory_section(
    db: AsyncSession,
    writer: PdfReportWriter,
    context: ReportContext,
) -> None:
    writer.section("Inventory")
    max_rows = SUMMARY_INVENTORY_ROWS if context.detail_level == "summary" else None
    all_totals = _inventory_totals_subquery(context, period_only=False)
    period_totals = _inventory_totals_subquery(context, period_only=True)
    query = (
        select(
            Shop.name.label("shop_name"),
            InventoryItem.id.label("item_id"),
            InventoryItem.name.label("item_name"),
            InventoryItem.base_unit.label("unit"),
            ShopInventoryAllocation.is_active,
            func.coalesce(all_totals.c.added_quantity, 0).label("added_quantity"),
            func.coalesce(all_totals.c.used_quantity, 0).label("used_quantity"),
            func.coalesce(period_totals.c.added_quantity, 0).label("period_added_quantity"),
            func.coalesce(period_totals.c.used_quantity, 0).label("period_used_quantity"),
        )
        .join(ShopInventoryAllocation, ShopInventoryAllocation.shop_id == Shop.id)
        .join(InventoryItem, InventoryItem.id == ShopInventoryAllocation.inventory_item_id)
        .outerjoin(
            all_totals,
            and_(
                all_totals.c.shop_id == Shop.id,
                all_totals.c.inventory_item_id == InventoryItem.id,
            ),
        )
        .outerjoin(
            period_totals,
            and_(
                period_totals.c.shop_id == Shop.id,
                period_totals.c.inventory_item_id == InventoryItem.id,
            ),
        )
        .order_by(
            Shop.name,
            ShopInventoryAllocation.sort_order,
            func.lower(InventoryItem.name),
            InventoryItem.id,
        )
    )
    query = _apply_shop_scope(query, context)
    if max_rows is not None:
        query = query.limit(max_rows)
    rows = (await db.execute(query)).all()
    category_labels = await _inventory_category_labels_by_item_id(
        db,
        [row.item_id for row in rows],
    )
    writer.note(
        f"Rows shown: {len(rows)}"
        + " allocated stock row(s). Added and Used are period movement totals."
    )
    writer.table(
        ["Branch", "Category", "Inventory Item", "Available", "Added", "Used", "Status"],
        (
            [
                row.shop_name,
                category_labels.get(row.item_id, "Uncategorized"),
                row.item_name,
                _quantity_with_unit(
                    _decimal(row.added_quantity) - _decimal(row.used_quantity), row.unit
                ),
                _quantity(row.period_added_quantity),
                _quantity(row.period_used_quantity),
                "Active" if row.is_active else "Paused",
            ]
            for row in rows
        ),
        [72, 82, 125, 82, 58, 58, 45],
        ["left", "left", "left", "right", "right", "right", "center"],
    )


async def _write_expenses_section(
    db: AsyncSession,
    writer: PdfReportWriter,
    context: ReportContext,
) -> None:
    # Centered header — same style as overall report statement header
    period_start = context.start.date()
    period_end = (context.end - timedelta(days=1)).date()
    if period_start == period_end:
        date_line = f"Date: {_date_text(period_start)}"
    else:
        date_line = f"Date: {_date_text(period_start)} To {_date_text(period_end)}"

    branch_label = _report_branch_header(context)
    writer.statement_header(
        _report_org_header(context),
        branch_label,
        "Expense Report",
        date_line,
    )

    filters: list[object] = [
        ExpenseEntry.spent_at >= context.start,
        ExpenseEntry.spent_at < context.end,
    ]
    scoped_shop_ids = context.scoped_shop_ids
    if scoped_shop_ids:
        filters.append(ExpenseEntry.shop_id.in_(scoped_shop_ids))
    else:
        filters.append(ExpenseEntry.id.is_(None))

    stats = (
        await db.execute(
            select(
                func.count(ExpenseEntry.id).label("expense_count"),
                func.coalesce(func.sum(ExpenseEntry.cash_amount), 0).label("total_cash_expenses"),
                func.coalesce(func.sum(ExpenseEntry.upi_amount), 0).label("total_upi_expenses"),
                func.coalesce(func.sum(ExpenseEntry.amount), 0).label("total_expenses"),
            )
            .select_from(ExpenseEntry)
            .where(*filters)
        )
    ).one()

    # Columns: Date | Branch | Expense | Expense (Cash) | Expense (UPI) | Total Expense
    widths = [70, 110, 130, 70, 70, 73]
    alignments = ["left", "left", "left", "right", "right", "right"]
    writer.table_header(
        ["Date", "Branch", "Expense", "Expense (Cash)", "Expense (UPI)", "Total Expense"],
        widths,
        alignments,
    )

    result = await db.execute(
        select(
            ExpenseEntry.spent_at,
            Shop.name.label("shop_name"),
            ExpenseEntry.expense_name,
            ExpenseEntry.cash_amount,
            ExpenseEntry.upi_amount,
            ExpenseEntry.amount,
        )
        .join(Shop, Shop.id == ExpenseEntry.shop_id)
        .where(*filters)
        .order_by(ExpenseEntry.spent_at.asc(), ExpenseEntry.id.asc())
    )
    page = result.all()
    for row in page:
        writer.table_row(
            [
                _ist_date_text(row.spent_at),
                row.shop_name,
                row.expense_name,
                _money(row.cash_amount),
                _money(row.upi_amount),
                _money(row.amount),
            ],
            widths,
            alignments,
        )

    # Summary at the bottom
    writer.financial_summary(
        [
            ("Total Expenses", str(int(stats.expense_count or 0))),
            ("Total Expense (Cash)", _money(stats.total_cash_expenses)),
            ("Total Expense (UPI)", _money(stats.total_upi_expenses)),
            ("Total Amount", _money(stats.total_expenses)),
        ]
    )


async def _generate_purchase_fpdf_pdf(
    db: AsyncSession,
    context: ReportContext,
    *,
    language: str = "en",
) -> bytes:
    """Purchase ADD report via FPDF2 (Tamil-safe)."""
    from app.services.reports.queries import (
        OverallReportPDF,
        _fpdf_draw_row,
        _fpdf_ensure_space,
        _fpdf_set_cell_font,
    )

    use_tamil = language == "ta"
    period_start = context.start.date()
    period_end = (context.end - timedelta(days=1)).date()
    if period_start == period_end:
        date_line = f"Date: {_date_text(period_start)}"
    else:
        date_line = f"Date: {_date_text(period_start)} To {_date_text(period_end)}"

    title = "கொள்முதல் அறிக்கை" if use_tamil else "Purchase Report"
    headers = (
        ["தேதி", "கொள்முதல் பெயர்", "எண்ணிக்கை", "சேர்த்த இருப்பு(kg)", "கொள்முதல் விலை", "மொத்த தொகை"]
        if use_tamil
        else [
            "Date",
            "Purchase Name",
            "Total Count",
            "Adding Stocks(kg)",
            "Purchase Rate",
            "Total Amount",
        ]
    )

    filters: list[object] = [
        InventoryMovement.occurred_at >= context.start,
        InventoryMovement.occurred_at < context.end,
        InventoryMovement.movement_type == InventoryMovementType.ADD,
        InventoryItem.base_unit == BaseUnit.KG,
    ]
    scoped_shop_ids = context.scoped_shop_ids
    if scoped_shop_ids:
        filters.append(InventoryMovement.shop_id.in_(scoped_shop_ids))
    else:
        filters.append(InventoryMovement.id.is_(None))
    scoped_purchaser_ids = context.scoped_purchaser_ids
    if scoped_purchaser_ids:
        filters.append(InventoryMovement.purchaser_id.in_(scoped_purchaser_ids))

    page = (
        await db.execute(
            select(
                InventoryMovement.occurred_at,
                InventoryMovement.purchaser_name,
                func.coalesce(
                    InventoryMovement.purchaser_tamil_name,
                    Purchaser.tamil_name,
                ).label("purchaser_tamil_name"),
                InventoryMovement.bird_count,
                InventoryMovement.quantity,
                InventoryMovement.inventory_item_id,
            )
            .join(InventoryItem, InventoryItem.id == InventoryMovement.inventory_item_id)
            .outerjoin(Purchaser, Purchaser.id == InventoryMovement.purchaser_id)
            .where(*filters)
            .order_by(InventoryMovement.occurred_at.asc(), InventoryMovement.id.asc())
        )
    ).all()

    item_ids = {row.inventory_item_id for row in page}
    ist_dates = {to_ist(row.occurred_at).date() for row in page if row.occurred_at is not None}
    history_map: dict[tuple[UUID, date], Decimal] = {}
    current_rate_map: dict[UUID, Decimal] = {}
    if item_ids:
        if ist_dates:
            history_rows = (
                await db.execute(
                    select(
                        InventoryItemPurchaseRateHistory.inventory_item_id,
                        InventoryItemPurchaseRateHistory.date,
                        InventoryItemPurchaseRateHistory.purchase_rate,
                    ).where(
                        InventoryItemPurchaseRateHistory.inventory_item_id.in_(item_ids),
                        InventoryItemPurchaseRateHistory.date.in_(ist_dates),
                    )
                )
            ).all()
            history_map = {
                (row.inventory_item_id, row.date): _decimal(row.purchase_rate)
                for row in history_rows
            }
        current_rows = (
            await db.execute(
                select(InventoryItem.id, InventoryItem.purchase_rate).where(
                    InventoryItem.id.in_(item_ids)
                )
            )
        ).all()
        current_rate_map = {
            row.id: _decimal(row.purchase_rate)
            for row in current_rows
            if row.purchase_rate is not None
        }

    widths = [70, 140, 70, 90, 85, 100]
    alignments = ["center", "left", "center", "center", "right", "right"]
    table_rows: list[list[object]] = []
    total_kg = Decimal("0")
    total_amount = Decimal("0")
    for row in page:
        qty = _decimal(row.quantity)
        total_kg += qty
        loss_date = to_ist(row.occurred_at).date() if row.occurred_at is not None else None
        rate: Decimal | None = None
        if loss_date is not None:
            rate = history_map.get((row.inventory_item_id, loss_date))
        if rate is None:
            rate = current_rate_map.get(row.inventory_item_id)
        if rate is None:
            rate_text = "—"
            amount_text = "—"
        else:
            amount = (qty * rate).quantize(Decimal("0.01"))
            total_amount += amount
            rate_text = _money(rate)
            amount_text = _money(amount)
        table_rows.append(
            [
                _ist_date_text(row.occurred_at),
                # Tamil report: Tamil name only (fallback English if missing).
                _retailer_item_name_cell(
                    row.purchaser_name, row.purchaser_tamil_name, use_tamil=use_tamil
                ),
                int(row.bird_count or 0),
                f"{qty.quantize(Decimal('0.01'))}",
                rate_text,
                amount_text,
            ]
        )

    pdf = OverallReportPDF(orientation="landscape", unit="pt", format="A4")
    pdf.compress = False
    _register_fpdf_fonts(pdf)
    pdf.set_text_shaping(True)
    pdf.set_text_color(31, 39, 51)
    pdf.add_page()

    def _draw_centered(text: str, size: float, *, bold: bool = True) -> None:
        style = "B" if bold else ""
        if _has_tamil_text(text):
            pdf.set_font("NotoSansTamil", style=style, size=size)
        else:
            pdf.set_font("NotoSans", style=style, size=size)
        pdf.cell(0, size + 4, text=text, align="C", new_x="LMARGIN", new_y="NEXT")

    _draw_centered(_report_org_header(context), 14)
    _draw_centered(_report_branch_header(context), 11)
    _draw_centered(title, 10)
    pdf.set_text_color(97, 110, 128)
    _draw_centered(date_line, 9, bold=False)
    pdf.set_text_color(31, 39, 51)
    pdf.ln(8)

    available = pdf.w - pdf.l_margin - pdf.r_margin
    total_w = sum(widths)
    if total_w > 0 and total_w != available:
        scale = available / total_w
        widths = [max(36, int(w * scale)) for w in widths]
        widths[-1] += available - sum(widths)

    line_height = 11.0
    padding = 3.0

    def _draw_header() -> None:
        pdf.set_text_color(255, 255, 255)
        _fpdf_draw_row(
            pdf,
            widths,
            alignments,
            headers,
            line_height=line_height,
            padding=padding,
            fill=True,
            fill_color=(31, 39, 51),
            is_header=True,
            bold_borders=True,
            header_font_size=7.5,
        )
        pdf.set_text_color(31, 39, 51)

    _draw_header()
    for index, row in enumerate(table_rows):
        _fpdf_draw_row(
            pdf,
            widths,
            alignments,
            row,
            line_height=line_height,
            padding=padding,
            fill=index % 2 == 1,
            fill_color=(248, 250, 252),
            is_header=False,
            header_drawer=_draw_header,
            bold_borders=True,
            header_font_size=8.0,
        )

    summary = [
        ("மொத்த Kg" if use_tamil else "Total Kg", f"{total_kg.quantize(Decimal('0.01'))}"),
        ("மொத்த தொகை" if use_tamil else "Total Amount", _money(total_amount)),
    ]
    _fpdf_ensure_space(pdf, 20 + len(summary) * 16)
    pdf.ln(12)
    y = pdf.get_y()
    for i, (label, value) in enumerate(summary):
        row_y = y + i * 16
        if row_y + 14 > pdf.page_break_trigger:
            pdf.add_page()
            y = pdf.get_y()
            row_y = y
        _fpdf_set_cell_font(pdf, label, is_header=True, font_size=9)
        pdf.set_xy(pdf.w - 220, row_y)
        pdf.cell(100, 14, text=label, align="L")
        _fpdf_set_cell_font(pdf, value, is_header=True, font_size=9)
        pdf.set_xy(pdf.w - pdf.r_margin - 90, row_y)
        pdf.cell(90, 14, text=value, align="R")

    return bytes(pdf.output())


def _format_retailer_item_qty(quantity: Decimal, unit: str) -> str:
    qty = float(quantity)
    if unit == "kg":
        return f"{qty:g} Kg"
    return f"{qty:g} Units"


def _bilingual_name_cell(
    english: object,
    tamil: object,
    *,
    use_tamil: bool,
) -> str:
    """Primary + secondary name lines for Tamil-safe PDF cells."""
    en = _normalize_report_text(str(english or ""))
    ta = _normalize_report_text(str(tamil or ""))
    if use_tamil:
        primary = ta or en
        secondary = en if ta and en and ta != en else ""
    else:
        primary = en or ta
        secondary = ta if en and ta and ta != en else ""
    if secondary:
        return f"{primary}\n{secondary}"
    return primary or "—"


def _retailer_party_cell(retailer_name: object, shop_name: object) -> str:
    name = _normalize_report_text(str(retailer_name or "")) or "—"
    shop = _normalize_report_text(str(shop_name or ""))
    if shop:
        return f"{name}\n{shop}"
    return name


def _retailer_item_name_cell(
    item_name: object,
    item_tamil_name: object,
    *,
    use_tamil: bool,
) -> str:
    english = _normalize_report_text(str(item_name or ""))
    tamil = _normalize_report_text(str(item_tamil_name or ""))
    if use_tamil:
        return tamil or english or "-"
    return english or "-"


_RETAILER_REPORT_HEADERS_EN = [
    "Bill No",
    "Date",
    "Retailer",
    "Items",
    "Kg/Units",
    "Price (Rs.)",
    "Amount (Rs.)",
    "Wallet Credit (Rs.)",
    "Paid (Rs.)",
    "Cash (Rs.)",
    "UPI (Rs.)",
    "Balance (Rs.)",
]
_RETAILER_REPORT_HEADERS_TA = [
    "பில் எண்",
    "தேதி",
    "சில்லறை விற்பனையாளர்",
    "பொருட்கள்",
    "Kg/அலகு",
    "விலை (Rs.)",
    "தொகை (Rs.)",
    "வாலட் கடன் (Rs.)",
    "செலுத்தியது (Rs.)",
    "ரொக்கம் (Rs.)",
    "UPI (Rs.)",
    "நிலுவை (Rs.)",
]


async def _retailer_wallet_balances_for_report(
    db: AsyncSession,
    context: ReportContext,
) -> list[tuple[str, str]]:
    scoped_shop_ids = context.scoped_shop_ids
    scoped_retailer_ids = context.scoped_retailer_ids

    query = select(Retailer.name, Retailer.credit_balance).order_by(Retailer.name)
    if scoped_retailer_ids:
        query = query.where(Retailer.id.in_(scoped_retailer_ids))
    elif scoped_shop_ids:
        query = (
            query.join(ShopRetailerAllocation, ShopRetailerAllocation.retailer_id == Retailer.id)
            .where(
                ShopRetailerAllocation.shop_id.in_(scoped_shop_ids),
                ShopRetailerAllocation.is_active == True,
            )
            .distinct()
        )
    else:
        return []

    rows = (await db.execute(query)).all()
    return [(row.name, _money(row.credit_balance)) for row in rows]


async def _retailer_opening_balances_for_report(
    db: AsyncSession,
    context: ReportContext,
) -> list[tuple[str, Decimal]]:
    """Return (retailer_name, opening_balance) for retailers in report scope."""
    scoped_shop_ids = context.scoped_shop_ids
    scoped_retailer_ids = context.scoped_retailer_ids

    query = select(Retailer.name, Retailer.opening_balance).order_by(Retailer.name)
    if scoped_retailer_ids:
        query = query.where(Retailer.id.in_(scoped_retailer_ids))
    elif scoped_shop_ids:
        retailer_ids_subq = (
            select(ShopRetailerAllocation.retailer_id)
            .where(
                ShopRetailerAllocation.shop_id.in_(scoped_shop_ids),
                ShopRetailerAllocation.is_active.is_(True),
            )
            .distinct()
            .subquery()
        )
        query = query.where(Retailer.id.in_(select(retailer_ids_subq.c.retailer_id)))
    else:
        return []

    rows = (await db.execute(query)).all()
    return [
        (row.name, Decimal(str(row.opening_balance or "0.00")).quantize(Decimal("0.01")))
        for row in rows
    ]


def _retailer_opening_balance_meta_lines(
    opening_balances: list[tuple[str, Decimal]],
    *,
    use_tamil: bool = False,
) -> list[str]:
    if not opening_balances:
        return []
    # Same layout as retailer cell (name + line under): name, then opening-balance label.
    label = "தொடக்க இருப்பு" if use_tamil else "Opening Balance"
    lines: list[str] = []
    for name, amount in opening_balances:
        amount_text = _money_amount(amount)
        party = _normalize_report_text(str(name or ""))
        if party:
            lines.append(f"{party}\n{label}: {amount_text}")
        else:
            lines.append(f"{label}: {amount_text}")
    return lines


async def _collect_retailers_report_table(
    db: AsyncSession,
    context: ReportContext,
    *,
    use_tamil: bool,
) -> tuple[
    list[str],
    list[list[object]],
    list[int],
    list[str],
    list[tuple[str, str]],
    list[tuple[str, str]],
    list[str],
]:
    """Build retailer sales table rows + summary metrics for PDF renderers."""
    from collections import defaultdict

    from app.models.retailer import RetailerSaleItem

    opening_balances = await _retailer_opening_balances_for_report(db, context)
    opening_meta = _retailer_opening_balance_meta_lines(opening_balances, use_tamil=use_tamil)
    opening_balances_total = sum((amount for _, amount in opening_balances), Decimal("0.00"))

    filters: list[object] = [
        RetailerSale.created_at >= context.start,
        RetailerSale.created_at < context.end,
    ]
    scoped_shop_ids = context.scoped_shop_ids
    if scoped_shop_ids:
        filters.append(RetailerSale.shop_id.in_(scoped_shop_ids))
    else:
        filters.append(RetailerSale.id.is_(None))

    scoped_retailer_ids = context.scoped_retailer_ids
    if scoped_retailer_ids:
        filters.append(RetailerSale.retailer_id.in_(scoped_retailer_ids))

    cash_subq = (
        select(
            RetailerPayment.retailer_sale_id.label("sale_id"),
            func.coalesce(func.sum(RetailerPayment.cash_amount), 0).label("cash_total"),
            func.coalesce(func.sum(RetailerPayment.upi_amount), 0).label("upi_total"),
            func.coalesce(func.sum(RetailerPayment.wallet_amount), 0).label("wallet_total"),
        )
        .group_by(RetailerPayment.retailer_sale_id)
        .subquery()
    )

    widths = [40, 36, 86, 64, 42, 32, 34, 34, 36, 32, 32, 34]
    alignments = [
        "left",
        "left",
        "left",
        "left",
        "right",
        "right",
        "right",
        "center",
        "right",
        "right",
        "right",
        "right",
    ]
    headers = list(_RETAILER_REPORT_HEADERS_TA if use_tamil else _RETAILER_REPORT_HEADERS_EN)

    rows = (
        await db.execute(
            select(
                RetailerSale.id,
                RetailerSale.sale_no,
                RetailerSale.created_at,
                func.coalesce(
                    func.nullif(RetailerSale.retailer_name, ""),
                    Retailer.name,
                ).label("retailer_name"),
                func.coalesce(
                    func.nullif(RetailerSale.shop_name, ""),
                    Shop.name,
                ).label("shop_name"),
                RetailerSale.total_amount,
                RetailerSale.amount_paid_total,
                RetailerSale.balance_due,
                func.coalesce(cash_subq.c.cash_total, 0).label("cash_total"),
                func.coalesce(cash_subq.c.upi_total, 0).label("upi_total"),
                func.coalesce(cash_subq.c.wallet_total, 0).label("wallet_total"),
            )
            .join(Retailer, Retailer.id == RetailerSale.retailer_id)
            .join(Shop, Shop.id == RetailerSale.shop_id)
            .outerjoin(cash_subq, cash_subq.c.sale_id == RetailerSale.id)
            .where(*filters)
            .order_by(RetailerSale.created_at.asc(), RetailerSale.id.asc())
        )
    ).all()

    sale_ids = [row.id for row in rows]
    items_by_sale: dict = defaultdict(list)
    if sale_ids:
        sale_items = (
            (
                await db.execute(
                    select(RetailerSaleItem)
                    .where(RetailerSaleItem.retailer_sale_id.in_(sale_ids))
                    .order_by(RetailerSaleItem.retailer_sale_id.asc(), RetailerSaleItem.id.asc())
                )
            )
            .scalars()
            .all()
        )
        for item in sale_items:
            items_by_sale[item.retailer_sale_id].append(item)

    total_balance = Decimal("0.00")
    total_paid = Decimal("0.00")
    total_wallet_credit = Decimal("0.00")
    total_kg = Decimal("0.000")
    total_unit = Decimal("0.000")
    table_rows: list[list[object]] = []

    for row in rows:
        total_balance += row.balance_due
        total_paid += row.amount_paid_total
        total_wallet_credit += row.wallet_total

        row_items = items_by_sale[row.id]
        for item in row_items:
            if item.unit.value == "kg":
                total_kg += item.quantity
            elif item.unit.value == "unit":
                total_unit += item.quantity

        bill_no = format_retailer_sale_bill_no(row.sale_no)
        bill_date = _ist_date_text(row.created_at)
        bill_amount = _money_amount(row.total_amount)
        bill_wallet = _money_amount(row.wallet_total)
        bill_paid = _money_amount(row.amount_paid_total)
        bill_balance = _money_amount(row.balance_due)
        bill_cash = _money_amount(row.cash_total)
        bill_upi = _money_amount(row.upi_total)

        if not row_items:
            table_rows.append(
                [
                    bill_no,
                    bill_date,
                    _retailer_party_cell(row.retailer_name, row.shop_name),
                    "-",
                    "-",
                    "-",
                    bill_amount,
                    bill_wallet,
                    bill_paid,
                    bill_cash,
                    bill_upi,
                    bill_balance,
                ]
            )
            continue

        for index, item in enumerate(row_items):
            is_first = index == 0
            is_last = index == len(row_items) - 1
            table_rows.append(
                [
                    bill_no if is_first else "",
                    bill_date if is_first else "",
                    _retailer_party_cell(row.retailer_name, row.shop_name) if is_first else "",
                    _retailer_item_name_cell(
                        item.item_name, item.item_tamil_name, use_tamil=use_tamil
                    ),
                    _format_retailer_item_qty(item.quantity, item.unit.value),
                    _money_amount(item.price_per_unit),
                    bill_amount if is_last else "",
                    bill_wallet if is_last else "",
                    bill_paid if is_last else "",
                    bill_cash if is_last else "",
                    bill_upi if is_last else "",
                    bill_balance if is_last else "",
                ]
            )

    (
        headers,
        table_rows,
        widths,
        alignments,
        kept_indices,
    ) = _filter_empty_report_columns(
        headers,
        table_rows,
        always_keep={0, 1, 2, 3},
        widths=widths,
        aligns=alignments,
    )
    assert widths is not None and alignments is not None

    wallet_balances = await _retailer_wallet_balances_for_report(db, context)
    total_outstanding = (total_balance + opening_balances_total).quantize(Decimal("0.01"))
    kept = set(kept_indices)
    if use_tamil:
        summary_rows: list[tuple[str, str]] = [
            ("மொத்த Kg", f"{float(total_kg):g} Kg"),
            ("மொத்த அலகு", f"{float(total_unit):g} Units"),
        ]
        if 7 in kept or total_wallet_credit != 0:
            summary_rows.append(("மொத்த வாலட் கடன்", _money(total_wallet_credit)))
        if 8 in kept or total_paid != 0:
            summary_rows.append(("மொத்த செலுத்தியது", _money(total_paid)))
        if 11 in kept or total_outstanding != 0:
            summary_rows.append(("மொத்த நிலுவை", _money(total_outstanding)))
    else:
        summary_rows = [
            ("Total Kg", f"{float(total_kg):g} Kg"),
            ("Total Unit", f"{float(total_unit):g} Units"),
        ]
        if 7 in kept or total_wallet_credit != 0:
            summary_rows.append(("Total Wallet Credit", _money(total_wallet_credit)))
        if 8 in kept or total_paid != 0:
            summary_rows.append(("Total Paid", _money(total_paid)))
        if 11 in kept or total_outstanding != 0:
            summary_rows.append(("Total Balance", _money(total_outstanding)))

    return headers, table_rows, widths, alignments, wallet_balances, summary_rows, opening_meta


async def _generate_retailers_fpdf_pdf(
    db: AsyncSession,
    context: ReportContext,
    *,
    language: str = "en",
) -> bytes:
    """Retailer sales PDF via FPDF2 — same Tamil font/shaping stack as Overall Report."""
    from app.services.reports.queries import (
        OverallReportPDF,
        _fpdf_draw_row,
        _fpdf_ensure_space,
        _fpdf_set_cell_font,
    )

    use_tamil = language == "ta"
    period_start = context.start.date()
    period_end = (context.end - timedelta(days=1)).date()
    if period_start == period_end:
        date_line = f"Date: {_date_text(period_start)}"
    else:
        date_line = f"Date: {_date_text(period_start)} To {_date_text(period_end)}"

    title = "சில்லறை விற்பனை அறிக்கை" if use_tamil else "Retailer Sales Report"
    wallet_title = "தற்போதைய வாலட் கடன்" if use_tamil else "Current Wallet Credit"

    (
        headers,
        table_rows,
        widths,
        alignments,
        wallet_balances,
        summary_rows,
        opening_meta,
    ) = await _collect_retailers_report_table(db, context, use_tamil=use_tamil)

    pdf = OverallReportPDF(orientation="landscape", unit="pt", format="A4")
    pdf.compress = False
    _register_fpdf_fonts(pdf)
    pdf.set_text_shaping(True)
    pdf.set_text_color(31, 39, 51)
    pdf.add_page()

    def _draw_centered(text: str, size: float, *, bold: bool = True) -> None:
        style = "B" if bold else ""
        if _has_tamil_text(text):
            pdf.set_font("NotoSansTamil", style=style, size=size)
        else:
            pdf.set_font("NotoSans", style=style, size=size)
        pdf.cell(0, size + 4, text=text, align="C", new_x="LMARGIN", new_y="NEXT")

    _draw_centered(_report_org_header(context), 14)
    _draw_centered(_report_branch_header(context), 11)
    _draw_centered(title, 10)
    pdf.set_text_color(97, 110, 128)
    _draw_centered(date_line, 9, bold=False)
    pdf.set_text_color(31, 39, 51)
    pdf.ln(6)

    if opening_meta:
        for block in opening_meta:
            for line in str(block).splitlines():
                if not line.strip():
                    continue
                _fpdf_set_cell_font(pdf, line, is_header=True, font_size=9)
                pdf.cell(0, 12, text=line, align="R", new_x="LMARGIN", new_y="NEXT")
            pdf.ln(2)
        pdf.ln(2)

    available = pdf.w - pdf.l_margin - pdf.r_margin
    total_w = sum(widths)
    if total_w > 0 and total_w != available:
        scale = available / total_w
        widths = [max(28, int(w * scale)) for w in widths]
        drift = available - sum(widths)
        if widths:
            widths[-1] += drift

    line_height = 11.0
    padding = 3.0
    header_font_size = 7.5

    def _draw_header() -> None:
        pdf.set_text_color(255, 255, 255)
        _fpdf_draw_row(
            pdf,
            widths,
            alignments,
            headers,
            line_height=line_height,
            padding=padding,
            fill=True,
            fill_color=(31, 39, 51),
            is_header=True,
            bold_borders=True,
            header_font_size=header_font_size,
        )
        pdf.set_text_color(31, 39, 51)

    _draw_header()

    for index, row in enumerate(table_rows):
        _fpdf_draw_row(
            pdf,
            widths,
            alignments,
            row,
            line_height=line_height,
            padding=padding,
            fill=index % 2 == 1,
            fill_color=(248, 250, 252),
            is_header=False,
            header_drawer=_draw_header,
            bold_borders=True,
            header_font_size=8.0,
        )

    summary_height = 20 + max(len(wallet_balances), len(summary_rows), 1) * 14 + 24
    _fpdf_ensure_space(pdf, summary_height)
    pdf.ln(10)
    left_x = pdf.l_margin
    right_label_x = pdf.w - 220
    y = pdf.get_y()
    # Clamp summary into content area (never into footer band).
    max_summary_bottom = pdf.page_break_trigger - 8
    row_count = max(len(wallet_balances), len(summary_rows), 1)
    needed = y + 16 + row_count * 14
    if needed > max_summary_bottom:
        pdf.add_page()
        y = pdf.get_y()

    _fpdf_set_cell_font(pdf, wallet_title, is_header=True, font_size=9)
    pdf.set_xy(left_x, y)
    pdf.cell(180, 14, text=wallet_title, align="L")

    for i in range(row_count):
        row_y = y + 16 + i * 14
        if row_y + 14 > pdf.page_break_trigger:
            break
        if i < len(wallet_balances):
            name, value = wallet_balances[i]
            _fpdf_set_cell_font(pdf, name, is_header=True, font_size=9)
            pdf.set_xy(left_x, row_y)
            pdf.cell(120, 14, text=name, align="L")
            _fpdf_set_cell_font(pdf, value, is_header=True, font_size=9)
            pdf.set_xy(left_x + 120, row_y)
            pdf.cell(60, 14, text=value, align="R")
        if i < len(summary_rows):
            label, value = summary_rows[i]
            _fpdf_set_cell_font(pdf, label, is_header=True, font_size=9)
            pdf.set_xy(right_label_x, row_y)
            pdf.cell(100, 14, text=label, align="L")
            _fpdf_set_cell_font(pdf, value, is_header=True, font_size=9)
            pdf.set_xy(pdf.w - pdf.r_margin - 80, row_y)
            pdf.cell(80, 14, text=value, align="R")

    return bytes(pdf.output())


async def _generate_transfers_fpdf_pdf(
    db: AsyncSession,
    context: ReportContext,
    *,
    language: str = "en",
) -> bytes:
    """Transfer stock report via FPDF2 (Tamil-safe destination + item names)."""
    from app.services.reports.queries import (
        OverallReportPDF,
        _fpdf_draw_row,
        _fpdf_ensure_space,
        _fpdf_set_cell_font,
    )

    use_tamil = language == "ta"
    period_start = context.start.date()
    period_end = (context.end - timedelta(days=1)).date()
    if period_start == period_end:
        date_line = f"Date: {_date_text(period_start)}"
    else:
        date_line = f"Date: {_date_text(period_start)} To {_date_text(period_end)}"

    title = "இடமாற்ற இருப்பு அறிக்கை" if use_tamil else "Transfer Stock Report"
    headers = (
        ["தேதி", "மூல கிளை", "இலக்கு", "சரக்கு பொருள்", "அளவு", "அலகு"]
        if use_tamil
        else ["Date", "Source Branch", "Destination", "Inventory Item", "Qty", "Unit"]
    )

    filters: list[object] = [
        InventoryTransfer.occurred_at >= context.start,
        InventoryTransfer.occurred_at < context.end,
    ]
    scoped_shop_ids = context.scoped_shop_ids
    if scoped_shop_ids:
        filters.append(InventoryTransfer.source_shop_id.in_(scoped_shop_ids))
    else:
        filters.append(InventoryTransfer.id.is_(None))

    stats = (
        await db.execute(
            select(func.count(InventoryTransfer.id).label("transfer_count"))
            .select_from(InventoryTransfer)
            .where(*filters)
        )
    ).one()

    result = await db.execute(
        select(
            InventoryTransfer.occurred_at,
            Shop.name.label("source_shop_name"),
            TransferShop.name.label("transfer_shop_name"),
            TransferShop.tamil_name.label("transfer_shop_tamil_name"),
            InventoryItem.name.label("item_name"),
            InventoryItem.tamil_name.label("item_tamil_name"),
            InventoryTransfer.quantity,
            InventoryTransfer.unit,
        )
        .join(Shop, Shop.id == InventoryTransfer.source_shop_id)
        .join(TransferShop, TransferShop.id == InventoryTransfer.transfer_shop_id)
        .join(InventoryItem, InventoryItem.id == InventoryTransfer.inventory_item_id)
        .where(*filters)
        .order_by(InventoryTransfer.occurred_at.asc(), InventoryTransfer.id.asc())
    )
    page = result.all()

    widths = [70, 110, 130, 150, 55, 45]
    alignments = ["left", "left", "left", "left", "right", "center"]
    table_rows: list[list[object]] = [
        [
            _ist_date_text(row.occurred_at),
            row.source_shop_name,
            # Tamil report: Tamil name only (no English second line).
            _retailer_item_name_cell(
                row.transfer_shop_name,
                row.transfer_shop_tamil_name,
                use_tamil=use_tamil,
            ),
            _retailer_item_name_cell(
                row.item_name, row.item_tamil_name, use_tamil=use_tamil
            ),
            _quantity(row.quantity),
            _unit_value(row.unit),
        ]
        for row in page
    ]

    pdf = OverallReportPDF(orientation="landscape", unit="pt", format="A4")
    pdf.compress = False
    _register_fpdf_fonts(pdf)
    pdf.set_text_shaping(True)
    pdf.set_text_color(31, 39, 51)
    pdf.add_page()

    def _draw_centered(text: str, size: float, *, bold: bool = True) -> None:
        style = "B" if bold else ""
        if _has_tamil_text(text):
            pdf.set_font("NotoSansTamil", style=style, size=size)
        else:
            pdf.set_font("NotoSans", style=style, size=size)
        pdf.cell(0, size + 4, text=text, align="C", new_x="LMARGIN", new_y="NEXT")

    _draw_centered(_report_org_header(context), 14)
    _draw_centered(_report_branch_header(context), 11)
    _draw_centered(title, 10)
    pdf.set_text_color(97, 110, 128)
    _draw_centered(date_line, 9, bold=False)
    pdf.set_text_color(31, 39, 51)
    pdf.ln(8)

    available = pdf.w - pdf.l_margin - pdf.r_margin
    total_w = sum(widths)
    if total_w > 0 and total_w != available:
        scale = available / total_w
        widths = [max(36, int(w * scale)) for w in widths]
        widths[-1] += available - sum(widths)

    line_height = 11.0
    padding = 3.0

    def _draw_header() -> None:
        pdf.set_text_color(255, 255, 255)
        _fpdf_draw_row(
            pdf,
            widths,
            alignments,
            headers,
            line_height=line_height,
            padding=padding,
            fill=True,
            fill_color=(31, 39, 51),
            is_header=True,
            bold_borders=True,
            header_font_size=7.5,
        )
        pdf.set_text_color(31, 39, 51)

    _draw_header()
    for index, row in enumerate(table_rows):
        _fpdf_draw_row(
            pdf,
            widths,
            alignments,
            row,
            line_height=line_height,
            padding=padding,
            fill=index % 2 == 1,
            fill_color=(248, 250, 252),
            is_header=False,
            header_drawer=_draw_header,
            bold_borders=True,
            header_font_size=8.0,
        )

    total_label = "மொத்த இடமாற்றங்கள்" if use_tamil else "Total Transfers"
    total_value = str(int(stats.transfer_count or 0))
    _fpdf_ensure_space(pdf, 40)
    pdf.ln(12)
    y = pdf.get_y()
    if y + 14 > pdf.page_break_trigger:
        pdf.add_page()
        y = pdf.get_y()
    _fpdf_set_cell_font(pdf, total_label, is_header=True, font_size=9)
    pdf.set_xy(pdf.w - 220, y)
    pdf.cell(120, 14, text=total_label, align="L")
    _fpdf_set_cell_font(pdf, total_value, is_header=True, font_size=9)
    pdf.set_xy(pdf.w - pdf.r_margin - 80, y)
    pdf.cell(80, 14, text=total_value, align="R")

    return bytes(pdf.output())

