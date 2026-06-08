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
from reportlab.lib.pagesizes import A4
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
    ItemAssumptionStatus,
    Payment,
    Shop,
    ShopInventoryAllocation,
)
from app.schemas.admin import AdminReportDetailLevel, AdminReportSection, AnalyticsPeriod
from app.services.admin import _get_period_bounds

SECTION_ORDER: tuple[AdminReportSection, ...] = (
    "sales",
    "billing",
    "items",
    "inventory",
    "assumptions",
    "over_report",
)
SECTION_LABELS: dict[AdminReportSection, str] = {
    "sales": "Sales",
    "billing": "Billing",
    "items": "Items",
    "inventory": "Inventory",
    "assumptions": "Assumptions",
    "over_report": "Overall Report",
}
SUMMARY_BILL_ROWS = 25
SUMMARY_ITEM_ROWS = 50
SUMMARY_INVENTORY_ROWS = 100
FULL_QUERY_BATCH_SIZE = 500
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


@dataclass(frozen=True)
class OverReportItemRow:
    category: str
    item_name: str
    assumption_percent: Decimal | None
    used_stock: Decimal
    sales_kg: Decimal
    assumption_kg: Decimal
    difference_kg: Decimal
    today_price: Decimal | None
    sales_amount: Decimal
    assumption_amount: Decimal
    difference_amount: Decimal


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
        self._table_row_index = 0
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
        card_height = 112
        self._ensure_space(card_height + 18, repeat_table_header=False)
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
        self._ensure_space(44, repeat_table_header=False)
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
        self._ensure_space(28, repeat_table_header=False)
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
        return row_count

    def table_header(
        self,
        headers: list[str],
        widths: list[int],
        alignments: list[str] | None = None,
    ) -> None:
        state = TableState(headers=headers, widths=widths, alignments=alignments or ["left"] * len(headers))
        self._current_table = state
        self._table_row_index = 0
        self._draw_table_header(state)

    def table_row(
        self,
        row: Iterable[object],
        widths: list[int],
        alignments: list[str] | None = None,
    ) -> None:
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
        header_height = 22
        self._ensure_space(header_height, repeat_table_header=False)
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
            self._draw_table_header(self._current_table)

    def _new_page(self) -> None:
        self._draw_footer()
        self._canvas.showPage()
        self._y = self._height - self._margin

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
        elif section == "assumptions":
            await _write_assumptions_section(db, writer, context)
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


async def _write_assumptions_section(
    db: AsyncSession,
    writer: PdfReportWriter,
    context: ReportContext,
) -> None:
    writer.section("Assumptions")
    category_label = func.coalesce(func.nullif(func.trim(Item.category), ""), "Uncategorized")
    latest_price_filters = []
    if context.shop_ids:
        latest_price_filters.append(DailyPrice.shop_id.in_(context.shop_ids))
    else:
        latest_price_filters.append(Shop.is_active.is_(True))
    latest_prices = (
        select(
            DailyPrice.item_id.label("item_id"),
            DailyPrice.price_per_unit.label("actual_price"),
            DailyPrice.price_date.label("price_date"),
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
        .join(Shop, Shop.id == DailyPrice.shop_id)
        .where(*latest_price_filters)
        .subquery()
    )
    rows = (
        await db.execute(
            select(
                category_label.label("category"),
                Item.name.label("item_name"),
                Item.tamil_name.label("item_tamil_name"),
                Item.base_unit,
                Item.is_active,
                Item.assumption_percent,
                Item.assumption_inventory_item_id,
                Item.assumption_inventory_category_id,
                InventoryItem.name.label("inventory_item_name"),
                InventoryCategory.name.label("inventory_category_name"),
                latest_prices.c.actual_price,
                latest_prices.c.price_date,
            )
            .outerjoin(InventoryItem, InventoryItem.id == Item.assumption_inventory_item_id)
            .outerjoin(
                InventoryCategory,
                InventoryCategory.id == Item.assumption_inventory_category_id,
            )
            .outerjoin(
                latest_prices,
                and_(latest_prices.c.item_id == Item.id, latest_prices.c.rn == 1),
            )
            .where(Item.shop_id.is_(None))
            .order_by(category_label, Item.sort_order, func.lower(Item.name), Item.id)
        )
    ).all()
    status_counts = {
        ItemAssumptionStatus.CONFIGURED: 0,
        ItemAssumptionStatus.INCOMPLETE: 0,
        ItemAssumptionStatus.NOT_SET: 0,
        ItemAssumptionStatus.NOT_APPLICABLE: 0,
    }
    row_statuses = []
    for row in rows:
        status = _assumption_status(
            row.base_unit,
            row.assumption_percent,
            row.assumption_inventory_item_id,
            row.assumption_inventory_category_id,
        )
        status_counts[status] += 1
        row_statuses.append((row, status))

    writer.note(
        f"Rows shown: {len(rows)} catalogue item(s). "
        f"Configured: {status_counts[ItemAssumptionStatus.CONFIGURED]}; "
        f"Incomplete: {status_counts[ItemAssumptionStatus.INCOMPLETE]}; "
        f"Not set: {status_counts[ItemAssumptionStatus.NOT_SET]}; "
        f"Not applicable: {status_counts[ItemAssumptionStatus.NOT_APPLICABLE]}. "
        "Total price = actual price x assumption percent."
    )
    writer.table(
        ["Category", "Item", "Tamil", "Unit", "Actual", "Assump", "Total", "Inventory", "Stock Cat", "Status"],
        (
            [
                row.category,
                row.item_name,
                row.item_tamil_name,
                getattr(row.base_unit, "value", row.base_unit),
                _money_or_blank(row.actual_price),
                _percent(row.assumption_percent),
                _money_or_blank(_assumption_total_price(row.actual_price, row.assumption_percent)),
                row.inventory_item_name or "",
                row.inventory_category_name or "",
                _assumption_status_label(status, row.is_active),
            ]
            for row, status in row_statuses
        ),
        [46, 58, 58, 26, 50, 38, 50, 66, 62, 44],
        ["left", "left", "left", "center", "right", "right", "right", "left", "left", "center"],
    )


async def _write_over_report_section(
    db: AsyncSession,
    writer: PdfReportWriter,
    context: ReportContext,
) -> None:
    if not context.shops:
        writer.section("Overall Report")
        writer.note("No branch data available for the selected report scope.")
        return

    report_contexts = _over_report_section_contexts(context)
    split_by_day = len(report_contexts) > 1
    for report_context in report_contexts:
        title = "Overall Report"
        if split_by_day:
            title = f"Overall Report - {report_context.period_label}"
        for shop_id, shop_name in report_context.shops:
            writer.section(title)
            await _write_over_report_branch(db, writer, report_context, shop_id, shop_name)


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


async def _write_over_report_branch(
    db: AsyncSession,
    writer: PdfReportWriter,
    context: ReportContext,
    shop_id: UUID,
    shop_name: str,
) -> None:
    stock_totals = await _over_report_stock_totals(db, context, shop_id)
    expense_amount = await _over_report_expense_amount(db, context, shop_id)
    item_rows = await _over_report_item_rows(db, context, shop_id)

    sales_kg = sum((row.sales_kg for row in item_rows), Decimal("0"))
    assumption_kg = sum((row.assumption_kg for row in item_rows), Decimal("0"))
    difference_kg = sales_kg - assumption_kg
    sales_amount = sum((row.sales_amount for row in item_rows), Decimal("0"))
    assumption_amount = sum((row.assumption_amount for row in item_rows), Decimal("0"))
    difference_amount = sum((row.difference_amount for row in item_rows), Decimal("0"))
    total_available = stock_totals["opening_stock"] + stock_totals["adding_stock"]
    remaining_stock = total_available - stock_totals["used_stock"]
    end_label = (context.end - timedelta(days=1)).date().isoformat()

    writer.note(
        "SRI MAHALAKSHMI BROILERS | "
        f"{shop_name.upper()} - BRANCH | Statement | "
        f"From Date: {context.start.date().isoformat()} To Date: {end_label}"
    )
    writer.table(
        ["Particulars", "Value", "Format"],
        [
            ["Old Stock", _kg(stock_totals["opening_stock"]), ""],
            ["Adding Stock", _kg(stock_totals["adding_stock"]), ""],
            ["Old Stock + Adding Stock", _kg(total_available), "Total Available Stock"],
            ["Used Stock", _kg(stock_totals["used_stock"]), ""],
            ["Remaining Stock", _kg(remaining_stock), ""],
            ["Sales (Kg)", _kg(sales_kg), ""],
            ["Assumption (Kg)", _kg(assumption_kg), ""],
            ["Difference (Kg)", _kg(difference_kg), "Sales (Kg) - Assumption (Kg)"],
            ["Assumption Amount", _money(assumption_amount), ""],
            ["Expense Amount", _money(expense_amount), ""],
            ["Sales Amount", _money(sales_amount), ""],
            ["Difference Amount", _money(difference_amount), "Difference (Kg) * Today price"],
            ["Sales Amount - Expense Amount", _money(sales_amount - expense_amount), ""],
            ["Sales Amount - Assumption Amount", _money(sales_amount - assumption_amount), ""],
        ],
        [178, 112, 206],
        ["left", "right", "left"],
    )

    writer.table(
        ["Category", "Item", "Assump", "Used", "Sales", "Assump Kg", "Diff Kg", "Today", "Diff Amt"],
        (
            [
                row.category,
                row.item_name,
                _percent(row.assumption_percent),
                _kg(row.used_stock),
                _kg(row.sales_kg),
                _kg(row.assumption_kg),
                _kg(row.difference_kg),
                _money_or_blank(row.today_price),
                _money(row.difference_amount),
            ]
            for row in item_rows
        ),
        [56, 70, 42, 54, 54, 60, 52, 62, 66],
        ["left", "left", "right", "right", "right", "right", "right", "right", "right"],
    )


async def _over_report_stock_totals(
    db: AsyncSession,
    context: ReportContext,
    shop_id: UUID,
) -> dict[str, Decimal]:
    before_start = InventoryMovement.created_at < context.start
    in_period = and_(
        InventoryMovement.created_at >= context.start,
        InventoryMovement.created_at < context.end,
    )
    row = (
        await db.execute(
            select(
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
            .select_from(InventoryMovement)
            .join(InventoryItem, InventoryItem.id == InventoryMovement.inventory_item_id)
            .where(
                InventoryMovement.shop_id == shop_id,
                InventoryItem.base_unit == BaseUnit.KG,
            )
        )
    ).one()
    opening_stock = _decimal(row.opening_added) - _decimal(row.opening_used)
    return {
        "opening_stock": opening_stock,
        "adding_stock": _decimal(row.adding_stock),
        "used_stock": _decimal(row.used_stock),
    }


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


async def _over_report_item_rows(
    db: AsyncSession,
    context: ReportContext,
    shop_id: UUID,
) -> list[OverReportItemRow]:
    category_label = func.coalesce(func.nullif(func.trim(Item.category), ""), "Uncategorized")
    sales_totals = (
        select(
            BillItem.item_id.label("item_id"),
            func.coalesce(func.sum(BillItem.quantity), 0).label("sales_kg"),
            func.coalesce(func.sum(BillItem.line_total), 0).label("sales_amount"),
        )
        .join(Bill, Bill.id == BillItem.bill_id)
        .where(
            Bill.shop_id == shop_id,
            Bill.created_at >= context.start,
            Bill.created_at < context.end,
            BillItem.unit == BaseUnit.KG,
        )
        .group_by(BillItem.item_id)
        .subquery()
    )
    movement_totals = (
        select(
            InventoryMovement.inventory_item_id.label("inventory_item_id"),
            func.coalesce(func.sum(InventoryMovement.quantity), 0).label("used_stock"),
        )
        .where(
            InventoryMovement.shop_id == shop_id,
            InventoryMovement.created_at >= context.start,
            InventoryMovement.created_at < context.end,
            InventoryMovement.movement_type == InventoryMovementType.USE,
        )
        .group_by(InventoryMovement.inventory_item_id)
        .subquery()
    )
    mapping_sales = (
        select(
            movement_totals.c.inventory_item_id,
            InventoryItemBillingMapping.billing_item_id,
            movement_totals.c.used_stock,
            func.coalesce(sales_totals.c.sales_kg, 0).label("mapped_sales_kg"),
            func.sum(func.coalesce(sales_totals.c.sales_kg, 0))
            .over(
                partition_by=movement_totals.c.inventory_item_id
            )
            .label("item_sales_kg"),
        )
        .select_from(
            movement_totals.join(
                InventoryItemBillingMapping,
                InventoryItemBillingMapping.inventory_item_id
                == movement_totals.c.inventory_item_id,
            )
        )
        .outerjoin(
            sales_totals,
            sales_totals.c.item_id == InventoryItemBillingMapping.billing_item_id,
        )
        .subquery()
    )
    used_totals = (
        select(
            mapping_sales.c.billing_item_id,
            func.coalesce(
                func.sum(
                    case(
                        (
                            mapping_sales.c.item_sales_kg > 0,
                            mapping_sales.c.used_stock
                            * mapping_sales.c.mapped_sales_kg
                            / mapping_sales.c.item_sales_kg,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("used_stock"),
        )
        .group_by(mapping_sales.c.billing_item_id)
        .subquery()
    )
    latest_prices = (
        select(
            DailyPrice.item_id.label("item_id"),
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
    rows = (
        await db.execute(
            select(
                category_label.label("category"),
                Item.name.label("item_name"),
                Item.assumption_percent,
                latest_prices.c.today_price,
                func.coalesce(sales_totals.c.sales_kg, 0).label("sales_kg"),
                func.coalesce(sales_totals.c.sales_amount, 0).label("sales_amount"),
                func.coalesce(used_totals.c.used_stock, 0).label("used_stock"),
            )
            .outerjoin(sales_totals, sales_totals.c.item_id == Item.id)
            .outerjoin(
                used_totals,
                used_totals.c.billing_item_id == Item.id,
            )
            .outerjoin(
                latest_prices,
                and_(latest_prices.c.item_id == Item.id, latest_prices.c.rn == 1),
            )
            .where(Item.shop_id.is_(None), Item.base_unit == BaseUnit.KG)
            .order_by(category_label, Item.sort_order, func.lower(Item.name), Item.id)
        )
    ).all()

    report_rows: list[OverReportItemRow] = []
    for row in rows:
        sales_kg = _decimal(row.sales_kg)
        sales_amount = _decimal(row.sales_amount)
        today_price = _decimal(row.today_price) if row.today_price is not None else None
        assumption_percent = row.assumption_percent
        assumption_kg = (
            sales_kg * _decimal(assumption_percent) / Decimal("100")
            if assumption_percent is not None
            else Decimal("0")
        )
        difference_kg = sales_kg - assumption_kg
        assumption_amount = (
            assumption_kg * today_price if today_price is not None else Decimal("0")
        )
        difference_amount = (
            difference_kg * today_price if today_price is not None else Decimal("0")
        )
        report_rows.append(
            OverReportItemRow(
                category=row.category,
                item_name=row.item_name,
                assumption_percent=assumption_percent,
                used_stock=_decimal(row.used_stock),
                sales_kg=sales_kg,
                assumption_kg=assumption_kg,
                difference_kg=difference_kg,
                today_price=today_price,
                sales_amount=sales_amount,
                assumption_amount=assumption_amount,
                difference_amount=difference_amount,
            )
        )
    return report_rows


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


def _assumption_status(
    base_unit: BaseUnit,
    assumption_percent: object,
    inventory_item_id: UUID | None,
    inventory_category_id: UUID | None,
) -> ItemAssumptionStatus:
    if base_unit != BaseUnit.KG:
        return ItemAssumptionStatus.NOT_APPLICABLE
    values = (assumption_percent, inventory_item_id, inventory_category_id)
    if all(value is None for value in values):
        return ItemAssumptionStatus.NOT_SET
    if assumption_percent is not None:
        return ItemAssumptionStatus.CONFIGURED
    return ItemAssumptionStatus.INCOMPLETE


def _assumption_status_label(status: ItemAssumptionStatus, active: bool) -> str:
    if not active:
        return "Paused"
    return {
        ItemAssumptionStatus.CONFIGURED: "Configured",
        ItemAssumptionStatus.INCOMPLETE: "Incomplete",
        ItemAssumptionStatus.NOT_SET: "Not set",
        ItemAssumptionStatus.NOT_APPLICABLE: "N/A",
    }[status]


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


def _money_or_blank(value: object) -> str:
    if value is None:
        return ""
    return _money(value)


def _percent(value: object) -> str:
    if value is None:
        return ""
    return f"{_quantity(value)}%"


def _kg(value: object) -> str:
    return f"{_quantity(value)} kg"


def _assumption_total_price(actual_price: object, assumption_percent: object) -> Decimal | None:
    if actual_price is None or assumption_percent is None:
        return None
    return _decimal(actual_price) * _decimal(assumption_percent) / Decimal("100")


def _quantity(value: object) -> str:
    quantity = _decimal(value).quantize(Decimal("0.001"))
    return f"{quantity:f}".rstrip("0").rstrip(".") or "0"


def _datetime_text(value: datetime | None) -> str:
    return value.strftime("%Y-%m-%d %H:%M") if value is not None else ""
