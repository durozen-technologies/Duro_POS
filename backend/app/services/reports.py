from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from tempfile import SpooledTemporaryFile
from textwrap import shorten, wrap
from typing import BinaryIO, Iterable, Iterator
from uuid import UUID

from fastapi import HTTPException, status
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from sqlalchemy import and_, case, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BaseUnit,
    Bill,
    BillItem,
    DailyPrice,
    ExpenseEntry,
    InventoryCategory,
    InventoryItem,
    InventoryItemBillingMapping,
    InventoryItemCategory,
    InventoryMovement,
    InventoryMovementType,
    Item,
    Payment,
    Shop,
    ShopInventoryAllocation,
)
from app.schemas.admin import (
    AdminReportDetailLevel,
    AdminReportSection,
    AnalyticsPeriod,
    OverallReportBillingItem,
    OverallReportInventoryItem,
    OverallReportRead,
    OverallReportStatement,
    OverallReportUnitSummary,
    OverallReportUsedStockBreakdown,
)
from app.services.admin import _get_period_bounds

SECTION_ORDER: tuple[AdminReportSection, ...] = (
    "sales",
    "billing",
    "items",
    "inventory",
    "over_report",
)
SECTION_LABELS: dict[AdminReportSection, str] = {
    "sales": "Sales",
    "billing": "Billing",
    "items": "Items",
    "inventory": "Inventory",
    "over_report": "Overall Report",
}
SUMMARY_BILL_ROWS = 25
SUMMARY_ITEM_ROWS = 50
SUMMARY_INVENTORY_ROWS = 100
FULL_QUERY_BATCH_SIZE = 500
OVER_REPORT_SHEET_HEADERS = [
    "Date",
    "Inventory Item",
    "Old Stock (kg / Unit)",
    "Adding Stock (kg / Unit)",
    "Total Available Stock (kg / Unit)",
    "Used Stock (kg / Unit)",
    "Remaining Stock (kg / Unit)",
    "Billing Items",
    "Assumption (kg / Unit)",
    "Sales (kg / Unit)",
    "Difference (kg / Unit)",
    "Assumption Amount",
    "Sales Amount",
    "Difference Amount",
]
OVER_REPORT_SHEET_WIDTHS = [46, 58, 54, 56, 60, 62, 56, 68, 66, 52, 56, 58, 56, 56]
OVER_REPORT_SHEET_ALIGNMENTS = [
    "center",
    "left",
    "right",
    "right",
    "right",
    "left",
    "right",
    "left",
    "right",
    "right",
    "right",
    "right",
    "right",
    "right",
]
TAMIL_FONT_REGULAR = "BillingReportNotoSansTamil"
TAMIL_FONT_BOLD = "BillingReportNotoSansTamilBold"
TAMIL_FONT_REGULAR_PATHS = (
    Path("/usr/share/fonts/truetype/noto/NotoSansTamil-Regular.ttf"),
    Path("/usr/share/fonts/truetype/noto/NotoSerifTamil-Regular.ttf"),
)
TAMIL_FONT_BOLD_PATHS = (
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


@dataclass(frozen=True)
class TableState:
    headers: list[str]
    widths: list[int]
    alignments: list[str]


SoldItemCategoryKey = tuple[UUID, str, object]


class PdfReportWriter:
    def __init__(self, output: BinaryIO) -> None:
        self._canvas = Canvas(output, pagesize=A4, pageCompression=0)
        self._font_regular = "Helvetica"
        self._font_bold = "Helvetica-Bold"
        self._tamil_font_regular, self._tamil_font_bold = _resolve_tamil_fonts()
        self._width, self._height = A4
        self._margin = 36
        self._bottom = 54
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
        self._bottom = 36
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

    def sheet_table(
        self,
        headers: list[str],
        rows: Iterable[Iterable[object]],
        widths: list[int],
        alignments: list[str],
    ) -> int:
        state = TableState(headers=headers, widths=widths, alignments=alignments)
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
        state = TableState(headers=headers, widths=widths, alignments=alignments or ["left"] * len(headers))
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
        self._canvas.roundRect(self._margin, header_y, sum(state.widths), header_height, 5, stroke=1, fill=1)
        self._set_fill((1, 1, 1))
        self._canvas.setFont(self._font_bold, 7)
        x = self._margin
        for header, width, alignment in zip(state.headers, state.widths, state.alignments, strict=True):
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

    def _draw_sheet_table_header(self, state: TableState) -> None:
        font_size = 5.4
        line_height = 6.2
        padding = 3
        cell_lines = [
            _pdf_text_lines(
                header,
                max(7, int((width - padding * 2) / 2.5)),
            )
            for header, width in zip(state.headers, state.widths, strict=True)
        ]
        max_lines = max((len(lines) for lines in cell_lines), default=1)
        header_height = max(26, padding * 2 + font_size + line_height * (max_lines - 1))
        self._ensure_space(int(header_height), repeat_table_header=False)
        self._page_has_content = True
        header_y = self._y - header_height
        self._set_fill((0.90, 0.90, 0.90))
        self._set_stroke((0.35, 0.35, 0.35))
        self._canvas.rect(self._margin, header_y, sum(state.widths), header_height, stroke=1, fill=1)
        x = self._margin
        self._set_fill(self._text)
        for lines, width, alignment in zip(cell_lines, state.widths, state.alignments, strict=True):
            self._set_stroke((0.35, 0.35, 0.35))
            self._canvas.rect(x, header_y, width, header_height, stroke=1, fill=0)
            text_y = header_y + header_height - padding - font_size
            for line in lines:
                self._draw_cell_line(line, x, text_y, width, alignment, font_size=font_size, bold=True)
                text_y -= line_height
            x += width
        self._y -= header_height

    def _draw_sheet_table_row(self, row: Iterable[object], state: TableState) -> None:
        font_size = 5.6
        line_height = 6.4
        padding = 3
        row_values = list(row)
        cell_lines = [
            _pdf_text_lines(
                _format_cell(value),
                max(7, int((width - padding * 2) / 2.55)),
            )
            for value, width in zip(row_values, state.widths, strict=True)
        ]
        max_lines = max((len(lines) for lines in cell_lines), default=1)
        row_height = max(20, padding * 2 + font_size + line_height * (max_lines - 1))
        self._ensure_space(int(row_height), repeat_table_header=True)
        self._page_has_content = True
        row_y = self._y - row_height
        fill = (0.98, 0.98, 0.98) if self._table_row_index % 2 else (1, 1, 1)
        self._set_fill(fill)
        self._set_stroke((0.78, 0.78, 0.78))
        self._canvas.rect(self._margin, row_y, sum(state.widths), row_height, stroke=1, fill=1)
        x = self._margin
        self._set_fill(self._text)
        for lines, width, alignment in zip(cell_lines, state.widths, state.alignments, strict=True):
            self._set_stroke((0.78, 0.78, 0.78))
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
            self._canvas.setFont(self._tamil_font_bold if bold else self._tamil_font_regular, font_size)
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
    )

    output = SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b")
    writer = PdfReportWriter(output)
    if context.sections != ["over_report"]:
        writer.title(
            "Admin PDF Report",
            [
                f"Period: {context.period_label}",
                f"Branches: {context.branch_label}",
                f"Detail level: {context.detail_level.title()}",
                f"Sections: {', '.join(SECTION_LABELS[section] for section in context.sections)}",
            ],
        )

    for section in context.sections:
        if section == "sales":
            await _write_sales_section(db, writer, context)
        elif section == "billing":
            await _write_billing_section(db, writer, context)
        elif section == "items":
            await _write_items_section(db, writer, context)
        elif section == "inventory":
            await _write_inventory_section(db, writer, context)
        else:
            await _write_over_report_section(db, writer, context)

    writer.save()
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
) -> ReportContext:
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

    start, end = _get_period_bounds(period, reference_date, range_start_date, range_end_date)
    unique_shop_ids = tuple(dict.fromkeys(shop_ids or []))
    shops_query = select(Shop.id, Shop.name)
    if unique_shop_ids:
        shops_query = shops_query.where(Shop.id.in_(unique_shop_ids))
    shops_query = shops_query.order_by(Shop.name, Shop.id)
    shop_rows = (await db.execute(shops_query)).all()
    shops = [(row.id, row.name) for row in shop_rows]

    if unique_shop_ids:
        found_shop_ids = {shop_id for shop_id, _shop_name in shops}
        if set(unique_shop_ids) - found_shop_ids:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop not found")

    ordered_sections = [section for section in SECTION_ORDER if section in set(sections)]
    return ReportContext(
        sections=ordered_sections,
        detail_level=detail_level,
        period=period,
        start=start,
        end=end,
        shops=shops,
        shop_ids=unique_shop_ids,
    )


async def _write_sales_section(
    db: AsyncSession,
    writer: PdfReportWriter,
    context: ReportContext,
) -> None:
    writer.section("Sales")
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
    writer.note(f"Total revenue: {_money(total_revenue)} across {len(rows)} branch row(s).")
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
        [178, 48, 90, 90, 90],
        ["left", "right", "right", "right", "right"],
    )


async def _write_billing_section(
    db: AsyncSession,
    writer: PdfReportWriter,
    context: ReportContext,
) -> None:
    writer.section("Billing")
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
        [70, 95, 98, 62, 62, 62, 42],
        ["left", "left", "left", "right", "right", "right", "center"],
    )

    row_count = 0
    cursor_created_at: datetime | None = None
    cursor_id: UUID | None = None
    remaining = max_rows
    while remaining is None or remaining > 0:
        limit = FULL_QUERY_BATCH_SIZE if remaining is None else min(FULL_QUERY_BATCH_SIZE, remaining)
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
                [70, 95, 98, 62, 62, 62, 42],
                ["left", "left", "left", "right", "right", "right", "center"],
            )
            row_count += 1
        cursor_created_at = page[-1].created_at
        cursor_id = page[-1].id
        if remaining is not None:
            remaining -= len(page)
        if len(page) < limit:
            break
    writer.note(f"Billing rows written: {row_count}.")


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
                getattr(row.unit, "value", row.unit),
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
        .order_by(Shop.name, ShopInventoryAllocation.sort_order, func.lower(InventoryItem.name), InventoryItem.id)
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
                f"{_quantity(_decimal(row.added_quantity) - _decimal(row.used_quantity))} {getattr(row.unit, 'value', row.unit)}",
                _quantity(row.period_added_quantity),
                _quantity(row.period_used_quantity),
                "Active" if row.is_active else "Paused",
            ]
            for row in rows
        ),
        [72, 82, 125, 82, 58, 58, 45],
        ["left", "left", "left", "right", "right", "right", "center"],
    )


async def _write_over_report_section(
    db: AsyncSession,
    writer: PdfReportWriter,
    context: ReportContext,
) -> None:
    report = await _build_overall_report_for_context(db, context)
    if not report.statements:
        writer.section("Overall Report")
        writer.note("No branch data available for the selected report scope.")
        return

    for statement in report.statements:
        writer.use_landscape_page()
        _write_over_report_statement(writer, statement)


async def build_overall_report(
    db: AsyncSession,
    *,
    detail_level: AdminReportDetailLevel = "summary",
    period: AnalyticsPeriod = "date",
    reference_date: date | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
    shop_ids: list[UUID] | None = None,
) -> OverallReportRead:
    context = await _build_report_context(
        db,
        sections=["over_report"],
        detail_level=detail_level,
        period=period,
        reference_date=reference_date,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        shop_ids=shop_ids,
    )
    return await _build_overall_report_for_context(db, context)


async def _build_overall_report_for_context(
    db: AsyncSession,
    context: ReportContext,
) -> OverallReportRead:
    statements: list[OverallReportStatement] = []
    for report_context in _over_report_section_contexts(context):
        for shop_id, shop_name in report_context.shops:
            statements.append(
                await _build_overall_report_statement(db, report_context, shop_id, shop_name)
            )
    return OverallReportRead(
        period=context.period,
        detail_level=context.detail_level,
        period_label=context.period_label,
        statements=statements,
    )


async def _build_overall_report_statement(
    db: AsyncSession,
    context: ReportContext,
    shop_id: UUID,
    shop_name: str,
) -> OverallReportStatement:
    inventory_items = await _overall_report_inventory_items(db, context, shop_id)
    await _populate_overall_report_used_stock_breakdown(db, context, shop_id, inventory_items)
    await _populate_overall_report_billing_items(db, context, shop_id, inventory_items)
    unit_summaries = _overall_report_unit_summaries(inventory_items.values())
    expense_amount = await _over_report_expense_amount(db, context, shop_id)
    sales_amount = sum(
        (_decimal(item.sales_amount) for item in inventory_items.values()),
        Decimal("0"),
    )
    assumption_amount = sum(
        (_decimal(item.assumption_amount) for item in inventory_items.values()),
        Decimal("0"),
    )
    difference_amount = sum(
        (_decimal(item.difference_amount) for item in inventory_items.values()),
        Decimal("0"),
    )
    return OverallReportStatement(
        shop_id=shop_id,
        shop_name=shop_name,
        start_date=context.start.date(),
        end_date=(context.end - timedelta(days=1)).date(),
        period_label=context.period_label,
        unit_summaries=unit_summaries,
        expense_amount=expense_amount,
        sales_amount=sales_amount,
        assumption_amount=assumption_amount,
        difference_amount=difference_amount,
        sales_minus_expense_amount=sales_amount - expense_amount,
        sales_minus_assumption_amount=sales_amount - assumption_amount,
        inventory_items=list(inventory_items.values()),
    )


async def _overall_report_inventory_items(
    db: AsyncSession,
    context: ReportContext,
    shop_id: UUID,
) -> dict[UUID, OverallReportInventoryItem]:
    before_start = InventoryMovement.created_at < context.start
    in_period = and_(
        InventoryMovement.created_at >= context.start,
        InventoryMovement.created_at < context.end,
    )
    stock_totals = (
        select(
            InventoryMovement.inventory_item_id.label("inventory_item_id"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                before_start,
                                InventoryMovement.movement_type == InventoryMovementType.ADD,
                            ),
                            InventoryMovement.quantity,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("opening_added"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                before_start,
                                InventoryMovement.movement_type == InventoryMovementType.USE,
                            ),
                            InventoryMovement.quantity,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("opening_used"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                in_period,
                                InventoryMovement.movement_type == InventoryMovementType.ADD,
                            ),
                            InventoryMovement.quantity,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("adding_stock"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                in_period,
                                InventoryMovement.movement_type == InventoryMovementType.USE,
                            ),
                            InventoryMovement.quantity,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("used_stock"),
        )
        .where(InventoryMovement.shop_id == shop_id)
        .group_by(InventoryMovement.inventory_item_id)
        .subquery()
    )
    rows = (
        await db.execute(
            select(
                InventoryItem.id.label("inventory_item_id"),
                InventoryItem.name.label("item_name"),
                InventoryItem.tamil_name.label("item_tamil_name"),
                InventoryItem.base_unit.label("unit"),
                func.coalesce(stock_totals.c.opening_added, 0).label("opening_added"),
                func.coalesce(stock_totals.c.opening_used, 0).label("opening_used"),
                func.coalesce(stock_totals.c.adding_stock, 0).label("adding_stock"),
                func.coalesce(stock_totals.c.used_stock, 0).label("used_stock"),
            )
            .select_from(ShopInventoryAllocation)
            .join(InventoryItem, InventoryItem.id == ShopInventoryAllocation.inventory_item_id)
            .outerjoin(
                stock_totals,
                stock_totals.c.inventory_item_id == InventoryItem.id,
            )
            .where(ShopInventoryAllocation.shop_id == shop_id)
            .order_by(
                ShopInventoryAllocation.sort_order,
                func.lower(InventoryItem.name),
                InventoryItem.id,
            )
        )
    ).all()
    category_labels = await _inventory_category_labels_by_item_id(
        db,
        [row.inventory_item_id for row in rows],
    )
    items: dict[UUID, OverallReportInventoryItem] = {}
    for row in rows:
        old_stock = _decimal(row.opening_added) - _decimal(row.opening_used)
        adding_stock = _decimal(row.adding_stock)
        total_available_stock = old_stock + adding_stock
        used_stock = _decimal(row.used_stock)
        items[row.inventory_item_id] = OverallReportInventoryItem(
            inventory_item_id=row.inventory_item_id,
            item_name=row.item_name,
            item_tamil_name=row.item_tamil_name,
            category=category_labels.get(row.inventory_item_id, "Uncategorized"),
            unit=row.unit,
            old_stock=old_stock,
            adding_stock=adding_stock,
            total_available_stock=total_available_stock,
            used_stock=used_stock,
            remaining_stock=total_available_stock - used_stock,
        )
    return items


async def _populate_overall_report_used_stock_breakdown(
    db: AsyncSession,
    context: ReportContext,
    shop_id: UUID,
    inventory_items: dict[UUID, OverallReportInventoryItem],
) -> None:
    if not inventory_items:
        return

    rows = (
        await db.execute(
            select(
                InventoryMovement.inventory_item_id,
                InventoryMovement.category_id,
                InventoryCategory.name.label("category_name"),
                func.coalesce(func.sum(InventoryMovement.quantity), 0).label("quantity"),
            )
            .outerjoin(InventoryCategory, InventoryCategory.id == InventoryMovement.category_id)
            .where(
                InventoryMovement.shop_id == shop_id,
                InventoryMovement.inventory_item_id.in_(list(inventory_items)),
                InventoryMovement.created_at >= context.start,
                InventoryMovement.created_at < context.end,
                InventoryMovement.movement_type == InventoryMovementType.USE,
            )
            .group_by(
                InventoryMovement.inventory_item_id,
                InventoryMovement.category_id,
                InventoryCategory.name,
            )
            .order_by(
                InventoryMovement.inventory_item_id,
                func.lower(func.coalesce(InventoryCategory.name, "Used")),
                InventoryMovement.category_id,
            )
        )
    ).all()
    for row in rows:
        inventory_item = inventory_items.get(row.inventory_item_id)
        if inventory_item is None:
            continue
        label = row.category_name or "Used"
        inventory_item.used_stock_breakdown.append(
            OverallReportUsedStockBreakdown(
                category_id=row.category_id,
                category_name=row.category_name,
                label=label,
                quantity=_decimal(row.quantity),
            )
        )


async def _populate_overall_report_billing_items(
    db: AsyncSession,
    context: ReportContext,
    shop_id: UUID,
    inventory_items: dict[UUID, OverallReportInventoryItem],
) -> None:
    if not inventory_items:
        return

    sales_totals = (
        select(
            BillItem.item_id.label("billing_item_id"),
            func.coalesce(func.sum(BillItem.quantity), 0).label("sales_quantity"),
            func.coalesce(func.sum(BillItem.line_total), 0).label("sales_amount"),
        )
        .join(Bill, Bill.id == BillItem.bill_id)
        .where(
            Bill.shop_id == shop_id,
            Bill.created_at >= context.start,
            Bill.created_at < context.end,
        )
        .group_by(BillItem.item_id)
        .subquery()
    )
    latest_prices = (
        select(
            DailyPrice.item_id.label("billing_item_id"),
            DailyPrice.price_per_unit.label("today_price"),
            func.row_number()
            .over(
                partition_by=DailyPrice.item_id,
                order_by=(
                    DailyPrice.price_date.desc(),
                    DailyPrice.created_at.desc(),
                    DailyPrice.id.desc(),
                ),
            )
            .label("rn"),
        )
        .where(DailyPrice.shop_id == shop_id)
        .subquery()
    )
    category_label = func.coalesce(func.nullif(func.trim(Item.category), ""), "Uncategorized")
    rows = (
        await db.execute(
            select(
                InventoryItemBillingMapping.inventory_item_id,
                Item.id.label("billing_item_id"),
                Item.name.label("item_name"),
                Item.tamil_name.label("item_tamil_name"),
                category_label.label("category"),
                Item.base_unit.label("unit"),
                Item.assumption_percent,
                latest_prices.c.today_price,
                func.coalesce(sales_totals.c.sales_quantity, 0).label("sales_quantity"),
                func.coalesce(sales_totals.c.sales_amount, 0).label("sales_amount"),
            )
            .join(Item, Item.id == InventoryItemBillingMapping.billing_item_id)
            .outerjoin(
                sales_totals,
                sales_totals.c.billing_item_id == InventoryItemBillingMapping.billing_item_id,
            )
            .outerjoin(
                latest_prices,
                and_(
                    latest_prices.c.billing_item_id
                    == InventoryItemBillingMapping.billing_item_id,
                    latest_prices.c.rn == 1,
                ),
            )
            .where(InventoryItemBillingMapping.inventory_item_id.in_(list(inventory_items)))
            .order_by(
                InventoryItemBillingMapping.inventory_item_id,
                category_label,
                Item.sort_order,
                func.lower(Item.name),
                Item.id,
            )
        )
    ).all()
    for row in rows:
        inventory_item = inventory_items.get(row.inventory_item_id)
        if inventory_item is None:
            continue

        unit = row.unit
        sales_quantity = _decimal(row.sales_quantity)
        sales_amount = _decimal(row.sales_amount)
        today_price = _decimal(row.today_price) if row.today_price is not None else None
        assumption_percent = row.assumption_percent
        assumption_quantity = (
            _decimal(inventory_item.used_stock) * _decimal(assumption_percent) / Decimal("100")
            if assumption_percent is not None
            else Decimal("0")
        )
        difference_quantity = sales_quantity - assumption_quantity
        assumption_amount = (
            assumption_quantity * today_price if today_price is not None else Decimal("0")
        )
        difference_amount = (
            difference_quantity * today_price if today_price is not None else Decimal("0")
        )
        inventory_item.billing_items.append(
            OverallReportBillingItem(
                billing_item_id=row.billing_item_id,
                item_name=row.item_name,
                item_tamil_name=row.item_tamil_name,
                category=row.category,
                unit=unit,
                assumption_percent=assumption_percent,
                sales_quantity=sales_quantity,
                assumption_quantity=assumption_quantity,
                difference_quantity=difference_quantity,
                today_price=today_price,
                sales_amount=sales_amount,
                assumption_amount=assumption_amount,
                difference_amount=difference_amount,
            )
        )
        inventory_item.sales_quantity += sales_quantity
        inventory_item.assumption_quantity += assumption_quantity
        inventory_item.difference_quantity += difference_quantity
        inventory_item.sales_amount += sales_amount
        inventory_item.assumption_amount += assumption_amount
        inventory_item.difference_amount += difference_amount


def _overall_report_unit_summaries(
    inventory_items: Iterable[OverallReportInventoryItem],
) -> list[OverallReportUnitSummary]:
    summaries: dict[BaseUnit, OverallReportUnitSummary] = {}
    for item in inventory_items:
        summary = summaries.setdefault(item.unit, OverallReportUnitSummary(unit=item.unit))
        summary.old_stock += _decimal(item.old_stock)
        summary.adding_stock += _decimal(item.adding_stock)
        summary.total_available_stock += _decimal(item.total_available_stock)
        summary.used_stock += _decimal(item.used_stock)
        summary.remaining_stock += _decimal(item.remaining_stock)
        summary.sales_quantity += _decimal(item.sales_quantity)
        summary.assumption_quantity += _decimal(item.assumption_quantity)
        summary.difference_quantity += _decimal(item.difference_quantity)

    return sorted(summaries.values(), key=lambda summary: _unit_sort_key(summary.unit))


def _unit_sort_key(unit: BaseUnit) -> int:
    if unit == BaseUnit.KG:
        return 0
    if unit == BaseUnit.UNIT:
        return 1
    return 2


def _write_over_report_statement(
    writer: PdfReportWriter,
    statement: OverallReportStatement,
) -> None:
    writer.statement_header(
        "SRI MAHALAKSHMI BROILERS",
        f"{statement.shop_name.upper()} - BRANCH",
        "Statement",
        f"Date: {_date_text(statement.start_date)} To {_date_text(statement.end_date)}",
    )

    if not statement.inventory_items:
        writer.note("No allocated inventory items found for this branch and period.")
        return

    writer.sheet_table(
        OVER_REPORT_SHEET_HEADERS,
        _over_report_sheet_rows(statement),
        OVER_REPORT_SHEET_WIDTHS,
        OVER_REPORT_SHEET_ALIGNMENTS,
    )


def _over_report_sheet_rows(statement: OverallReportStatement) -> list[list[str]]:
    rows: list[list[str]] = []
    table_date = _statement_table_date(statement)
    for item in statement.inventory_items:
        used_rows = item.used_stock_breakdown or [
            OverallReportUsedStockBreakdown(
                label="Used",
                quantity=_decimal(item.used_stock),
            )
        ]
        billing_rows = item.billing_items or []
        row_count = max(1, len(used_rows), len(billing_rows) or 1)
        for index in range(row_count):
            is_first = index == 0
            used_row = used_rows[index] if index < len(used_rows) else None
            billing_row = billing_rows[index] if index < len(billing_rows) else None
            rows.append(
                [
                    table_date if is_first else "",
                    item.item_name if is_first else "",
                    _quantity_with_unit(item.old_stock, item.unit) if is_first else "",
                    _quantity_with_unit(item.adding_stock, item.unit) if is_first else "",
                    _quantity_with_unit(item.total_available_stock, item.unit) if is_first else "",
                    _used_stock_breakdown_text(used_row, item.unit),
                    _quantity_with_unit(item.remaining_stock, item.unit) if is_first else "",
                    billing_row.item_name if billing_row is not None else (
                        "No mapped billing sales" if is_first and not billing_rows else ""
                    ),
                    _quantity_with_unit(billing_row.assumption_quantity, billing_row.unit)
                    if billing_row is not None
                    else "",
                    _quantity_with_unit(billing_row.sales_quantity, billing_row.unit)
                    if billing_row is not None
                    else "",
                    _quantity_with_unit(billing_row.difference_quantity, billing_row.unit)
                    if billing_row is not None
                    else "",
                    _money(billing_row.assumption_amount) if billing_row is not None else "",
                    _money(billing_row.sales_amount) if billing_row is not None else "",
                    _money(billing_row.difference_amount) if billing_row is not None else "",
                ]
            )
    return rows


def _used_stock_breakdown_text(
    row: OverallReportUsedStockBreakdown | None,
    unit: BaseUnit,
) -> str:
    if row is None:
        return ""
    return f"{row.label}: {_quantity_with_unit(row.quantity, unit)}"


def _statement_table_date(statement: OverallReportStatement) -> str:
    if statement.start_date == statement.end_date:
        return _date_text(statement.start_date)
    return f"{_date_text(statement.start_date)} To {_date_text(statement.end_date)}"


def _over_report_section_contexts(context: ReportContext) -> list[ReportContext]:
    if context.detail_level != "full":
        return [context]

    days = _context_days(context)
    if len(days) <= 1:
        return [context]

    return [_context_for_day(context, day) for day in days]


def _context_days(context: ReportContext) -> list[date]:
    start_date = context.start.date()
    end_date = (context.end - timedelta(days=1)).date()
    days: list[date] = []
    current = start_date
    while current <= end_date:
        days.append(current)
        current += timedelta(days=1)
    return days


def _context_for_day(context: ReportContext, day: date) -> ReportContext:
    start = datetime(day.year, day.month, day.day, tzinfo=context.start.tzinfo)
    end = start + timedelta(days=1)
    return ReportContext(
        sections=context.sections,
        detail_level=context.detail_level,
        period="date",
        start=start,
        end=end,
        shops=context.shops,
        shop_ids=context.shop_ids,
    )


async def _over_report_expense_amount(
    db: AsyncSession,
    context: ReportContext,
    shop_id: UUID,
) -> Decimal:
    total = await db.scalar(
        select(func.coalesce(func.sum(ExpenseEntry.amount), Decimal("0.00"))).where(
            ExpenseEntry.shop_id == shop_id,
            ExpenseEntry.spent_at >= context.start,
            ExpenseEntry.spent_at < context.end,
        )
    )
    return _decimal(total).quantize(Decimal("0.01"))


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


def _inventory_totals_subquery(context: ReportContext, *, period_only: bool):
    filters = []
    if context.shop_ids:
        filters.append(InventoryMovement.shop_id.in_(context.shop_ids))
    if period_only:
        filters.extend([InventoryMovement.created_at >= context.start, InventoryMovement.created_at < context.end])
    added_quantity = func.coalesce(
        func.sum(
            case(
                (InventoryMovement.movement_type == InventoryMovementType.ADD, InventoryMovement.quantity),
                else_=0,
            )
        ),
        0,
    ).label("added_quantity")
    used_quantity = func.coalesce(
        func.sum(
            case(
                (InventoryMovement.movement_type == InventoryMovementType.USE, InventoryMovement.quantity),
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


def _bill_filters(context: ReportContext) -> list[object]:
    filters: list[object] = [Bill.created_at >= context.start, Bill.created_at < context.end]
    if context.shop_ids:
        filters.append(Bill.shop_id.in_(context.shop_ids))
    return filters


def _apply_shop_scope(query, context: ReportContext):
    if not context.shop_ids:
        return query
    return query.where(Shop.id.in_(context.shop_ids))


def _report_filename(context: ReportContext) -> str:
    period_start = context.start.date().isoformat()
    period_end = (context.end - timedelta(days=1)).date().isoformat()
    scope = "all-branches" if not context.shop_ids else f"{len(context.shop_ids)}-branches"
    return f"admin-report-{scope}-{period_start}-to-{period_end}.pdf"


def _format_cell(value: object) -> str:
    if isinstance(value, Decimal):
        return _quantity(value)
    if isinstance(value, datetime):
        return _datetime_text(value)
    return "" if value is None else str(value)


def _resolve_tamil_fonts() -> tuple[str, str]:
    regular = _register_pdf_font(TAMIL_FONT_REGULAR, TAMIL_FONT_REGULAR_PATHS)
    bold = _register_pdf_font(TAMIL_FONT_BOLD, TAMIL_FONT_BOLD_PATHS)
    return regular or "Helvetica", bold or regular or "Helvetica-Bold"


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


def _pdf_text(value: str, width: int) -> str:
    text = value.replace("\n", " ").replace("\r", " ")
    return shorten(text, width=max(4, width), placeholder="...")


def _pdf_text_lines(value: str, width: int) -> list[str]:
    text = value.replace("\n", " ").replace("\r", " ").strip()
    if not text:
        return [""]
    return wrap(
        text,
        width=max(4, width),
        break_long_words=True,
        break_on_hyphens=False,
        drop_whitespace=True,
    ) or [text]


def _decimal(value: object) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def _money(value: object) -> str:
    return f"Rs. {_decimal(value).quantize(Decimal('0.01'))}"


def _unit_value(unit: object) -> str:
    return str(getattr(unit, "value", unit))


def _quantity_with_unit(value: object, unit: object) -> str:
    return f"{_quantity(value)} {_unit_value(unit)}"


def _quantity(value: object) -> str:
    quantity = _decimal(value).quantize(Decimal("0.001"))
    return f"{quantity:f}".rstrip("0").rstrip(".") or "0"


def _datetime_text(value: datetime | None) -> str:
    return value.strftime("%Y-%m-%d %H:%M") if value is not None else ""


def _date_text(value: date) -> str:
    return value.strftime("%d/%m/%Y")
