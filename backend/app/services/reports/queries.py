from __future__ import annotations

import io
import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from textwrap import shorten, wrap
from uuid import UUID

from fpdf import FPDF
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from sqlalchemy import and_, case, distinct, func, or_, select, true
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
    InventoryTransfer,
    Item,
    Payment,
    Shop,
    ShopInventoryAllocation,
    TransferShop,
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
from app.services.reports.pdf import *  # noqa: F403
from app.services.reports.pdf import (
    FULL_QUERY_BATCH_SIZE,
    OVER_REPORT_SHEET_ALIGNMENTS,
    OVER_REPORT_SHEET_DATA_FONT_SIZE_FPDF,
    OVER_REPORT_SHEET_HEADER_ALIGNMENTS,
    OVER_REPORT_SHEET_HEADER_FONT_SIZE_FPDF,
    ReportContext,
    _build_report_context,
    _fpdf_over_report_sheet_widths,
    _fpdf_sheet_data_line_width,
    _inventory_category_labels_by_item_id,
    _over_report_sheet_headers,
    _report_branch_header,
    _report_org_header,
    _reportlab_over_report_sheet_widths,
    _reportlab_sheet_data_line_width,
)
from app.services.reports.pdf import (
    _date_text,
    _datetime_text,
    _decimal,
    _format_cell,
    _has_tamil_text,
    _money,
    _normalize_report_text,
    _pdf_text,
    _pdf_text_lines,
    _quantity,
    _quantity_with_unit,
    _register_fpdf_fonts,
    _register_pdf_font,
    _report_filename,
    _reportlab_sheet_cell_lines,
    _resolve_font_file,
    _resolve_tamil_fonts,
    _unit_value,
)


def _over_report_balance_amount(
    sales: Decimal | str | int | float,
    purchase: Decimal | str | int | float,
    expense: Decimal | str | int | float,
) -> Decimal:
    return _decimal(sales) - _decimal(purchase) - _decimal(expense)


async def build_overall_report(
    db: AsyncSession,
    *,
    detail_level: AdminReportDetailLevel = "summary",
    period: AnalyticsPeriod = "date",
    reference_date: date | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
    shop_ids: list[UUID] | None = None,
    organization_id: UUID | None = None,
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
        organization_id=organization_id,
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
        organization_name=context.organization_name,
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
    purchase_amount = sum(
        (_decimal(item.purchase_amount) for item in inventory_items.values()),
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
        purchase_amount=purchase_amount,
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
    before_start = InventoryMovement.occurred_at < context.start
    in_period = and_(
        InventoryMovement.occurred_at >= context.start,
        InventoryMovement.occurred_at < context.end,
    )
    transfer_before_start = InventoryTransfer.occurred_at < context.start
    transfer_in_period = and_(
        InventoryTransfer.occurred_at >= context.start,
        InventoryTransfer.occurred_at < context.end,
    )
    transfer_totals = (
        select(
            InventoryTransfer.inventory_item_id.label("inventory_item_id"),
            func.coalesce(
                func.sum(
                    case(
                        (transfer_before_start, InventoryTransfer.quantity),
                        else_=0,
                    )
                ),
                0,
            ).label("opening_transferred"),
            func.coalesce(
                func.sum(
                    case(
                        (transfer_in_period, InventoryTransfer.quantity),
                        else_=0,
                    )
                ),
                0,
            ).label("transfer_stock"),
        )
        .where(InventoryTransfer.source_shop_id == shop_id)
        .group_by(InventoryTransfer.inventory_item_id)
        .subquery()
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
                InventoryItem.purchase_rate.label("purchase_rate"),
                InventoryItem.base_unit.label("unit"),
                InventoryItem.purchase_rate.label("purchase_rate"),
                func.coalesce(stock_totals.c.opening_added, 0).label("opening_added"),
                func.coalesce(stock_totals.c.opening_used, 0).label("opening_used"),
                func.coalesce(stock_totals.c.adding_stock, 0).label("adding_stock"),
                func.coalesce(stock_totals.c.used_stock, 0).label("used_stock"),
                func.coalesce(transfer_totals.c.opening_transferred, 0).label(
                    "opening_transferred"
                ),
                func.coalesce(transfer_totals.c.transfer_stock, 0).label("transfer_stock"),
            )
            .select_from(ShopInventoryAllocation)
            .join(InventoryItem, InventoryItem.id == ShopInventoryAllocation.inventory_item_id)
            .outerjoin(
                stock_totals,
                stock_totals.c.inventory_item_id == InventoryItem.id,
            )
            .outerjoin(
                transfer_totals,
                transfer_totals.c.inventory_item_id == InventoryItem.id,
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
        old_stock = (
            _decimal(row.opening_added)
            - _decimal(row.opening_used)
            - _decimal(row.opening_transferred)
        )
        adding_stock = _decimal(row.adding_stock)
        total_available_stock = old_stock + adding_stock
        used_stock = _decimal(row.used_stock)
        transfer_stock = _decimal(row.transfer_stock)
        purchase_rate = _decimal(row.purchase_rate) if row.purchase_rate is not None else None
        purchase_amount = (
            (used_stock * purchase_rate) if purchase_rate is not None else Decimal("0")
        )
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
            transfer_stock=transfer_stock,
            remaining_stock=total_available_stock - used_stock - transfer_stock,
            purchase_rate=purchase_rate,
            purchase_amount=purchase_amount,
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
                InventoryMovement.occurred_at >= context.start,
                InventoryMovement.occurred_at < context.end,
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
    mapped_used_stock = (
        select(
            InventoryMovement.inventory_item_id,
            InventoryMovement.category_id,
            func.coalesce(func.sum(InventoryMovement.quantity), 0).label("used_stock"),
        )
        .where(
            InventoryMovement.shop_id == shop_id,
            InventoryMovement.occurred_at >= context.start,
            InventoryMovement.occurred_at < context.end,
            InventoryMovement.movement_type == InventoryMovementType.USE,
            InventoryMovement.category_id.is_not(None),
        )
        .group_by(InventoryMovement.inventory_item_id, InventoryMovement.category_id)
        .subquery()
    )
    category_label = func.coalesce(func.nullif(func.trim(Item.category), ""), "Uncategorized")
    rows = (
        await db.execute(
            select(
                InventoryItemBillingMapping.inventory_item_id,
                InventoryItemBillingMapping.inventory_category_id,
                InventoryCategory.name.label("inventory_category_name"),
                Item.id.label("billing_item_id"),
                Item.name.label("item_name"),
                Item.tamil_name.label("item_tamil_name"),
                category_label.label("category"),
                Item.base_unit.label("unit"),
                Item.assumption_percent,
                latest_prices.c.today_price,
                func.coalesce(mapped_used_stock.c.used_stock, 0).label("mapped_used_stock"),
                func.coalesce(sales_totals.c.sales_quantity, 0).label("sales_quantity"),
                func.coalesce(sales_totals.c.sales_amount, 0).label("sales_amount"),
            )
            .join(Item, Item.id == InventoryItemBillingMapping.billing_item_id)
            .outerjoin(
                InventoryCategory,
                InventoryCategory.id == InventoryItemBillingMapping.inventory_category_id,
            )
            .outerjoin(
                sales_totals,
                sales_totals.c.billing_item_id == InventoryItemBillingMapping.billing_item_id,
            )
            .outerjoin(
                latest_prices,
                and_(
                    latest_prices.c.billing_item_id == InventoryItemBillingMapping.billing_item_id,
                    latest_prices.c.rn == 1,
                ),
            )
            .outerjoin(
                mapped_used_stock,
                and_(
                    mapped_used_stock.c.inventory_item_id
                    == InventoryItemBillingMapping.inventory_item_id,
                    mapped_used_stock.c.category_id
                    == InventoryItemBillingMapping.inventory_category_id,
                ),
            )
            .where(InventoryItemBillingMapping.inventory_item_id.in_(list(inventory_items)))
            .order_by(
                InventoryItemBillingMapping.inventory_item_id,
                InventoryCategory.name.is_(None),
                func.lower(InventoryCategory.name),
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
        used_stock_source = (
            _decimal(row.mapped_used_stock)
            if row.inventory_category_id is not None
            else _decimal(inventory_item.used_stock)
        )
        assumption_quantity = (
            used_stock_source * _decimal(assumption_percent) / Decimal("100")
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
        summary.transfer_stock += _decimal(item.transfer_stock)
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


async def _write_over_report_section(
    db: AsyncSession,
    writer: PdfReportWriter,
    context: ReportContext,
    language: str = "en",
) -> None:
    report = await _build_overall_report_for_context(db, context)
    if not report.statements:
        writer.section("Overall Report")
        writer.note("No branch data available for the selected report scope.")
        return

    is_first = True
    writer.use_landscape_page()
    for statement in report.statements:
        if not is_first:
            writer._y -= 15
        _write_over_report_statement(
            writer, statement, print_header=is_first, report_context=context, language=language
        )
        is_first = False


def _write_over_report_statement(
    writer: PdfReportWriter,
    statement: OverallReportStatement,
    print_header: bool = True,
    report_context: ReportContext | None = None,
    language: str = "en",
) -> None:
    use_tamil = language == "ta"
    if print_header:
        if report_context:
            start_date = report_context.start.date()
            end_date = (report_context.end - timedelta(days=1)).date()
        else:
            start_date = statement.start_date
            end_date = statement.end_date

        if start_date == end_date:
            date_str = f"Date: {_date_text(start_date)}"
        else:
            date_str = f"Date: {_date_text(start_date)} To {_date_text(end_date)}"

        writer.statement_header(
            _report_org_header(report_context) if report_context else "ORGANIZATION",
            _report_branch_header(report_context, statement.shop_name)
            if report_context
            else statement.shop_name.upper(),
            "Statement",
            date_str,
        )

    if not statement.inventory_items:
        writer.note("No allocated inventory items found for this branch and period.")
        return

    sheet_headers = _over_report_sheet_headers(use_tamil=use_tamil)

    mapped_items = [i for i in statement.inventory_items if i.billing_items]
    unmapped_items = [i for i in statement.inventory_items if not i.billing_items]

    all_rows = _over_report_sheet_rows(statement.inventory_items, statement, use_tamil=use_tamil)
    mapped_rows = _over_report_sheet_rows(mapped_items, statement, use_tamil=use_tamil)
    unmapped_rows = _over_report_sheet_rows(unmapped_items, statement, use_tamil=use_tamil)

    sheet_widths = _reportlab_over_report_sheet_widths(
        sheet_headers,
        writer._available_width,
        all_rows,
    )

    if mapped_rows:
        writer.sheet_table(
            sheet_headers,
            mapped_rows,
            sheet_widths,
            OVER_REPORT_SHEET_ALIGNMENTS,
        )

    if unmapped_rows:
        if mapped_rows:
            writer._y -= 12

        writer._page_has_content = True
        writer._ensure_space(20, repeat_table_header=False)
        title = "No mapped billing Items"
        writer._set_text_font(title, 8, bold=True)
        writer._set_fill(writer._text)
        writer._canvas.drawCentredString(
            writer._margin + sum(sheet_widths[:8]) / 2, writer._y - 12, title
        )
        writer._y -= 20

        writer.sheet_table(
            sheet_headers[:8],
            [row[:8] for row in unmapped_rows],
            sheet_widths[:8],
            OVER_REPORT_SHEET_ALIGNMENTS[:8],
        )

    if statement.inventory_items:
        writer.financial_summary(
            [
                ("Total Sales", _money(statement.sales_amount)),
                ("Total Purchase", _money(statement.purchase_amount)),
                ("Total Expense Amount", _money(statement.expense_amount)),
                (
                    "Balance Amount",
                    _money(
                        _over_report_balance_amount(
                            statement.sales_amount,
                            statement.purchase_amount,
                            statement.expense_amount,
                        )
                    ),
                ),
            ]
        )


def _over_report_sheet_rows(
    items: list[OverallReportInventoryItem],
    statement: OverallReportStatement,
    use_tamil: bool = False,
) -> list[list[str]]:
    rows: list[list[str]] = []
    table_date = _statement_table_date(statement)
    is_single_date = statement.start_date == statement.end_date
    has_printed_date = False
    for item in items:
        inv_display_name = (item.item_tamil_name or item.item_name) if use_tamil else item.item_name
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

            if billing_row is not None:
                billing_display_name = (
                    (billing_row.item_tamil_name or billing_row.item_name)
                    if use_tamil
                    else billing_row.item_name
                )
            else:
                billing_display_name = None

            printed_date = ""
            if is_first and not has_printed_date:
                printed_date = table_date
                has_printed_date = True

            rows.append(
                [
                    printed_date,
                    inv_display_name if is_first else "",
                    _quantity_with_unit(item.old_stock, item.unit) if is_first else "",
                    _quantity_with_unit(item.adding_stock, item.unit) if is_first else "",
                    _quantity_with_unit(item.total_available_stock, item.unit) if is_first else "",
                    _used_stock_breakdown_text(used_row, item.unit),
                    _quantity_with_unit(item.transfer_stock, item.unit) if is_first else "",
                    _quantity_with_unit(item.remaining_stock, item.unit),
                    _money(item.purchase_rate)
                    if is_first and item.purchase_rate is not None
                    else "",
                    _money(item.purchase_amount) if is_first else "",
                    billing_display_name
                    if billing_row is not None
                    else ("No mapped billing sales" if is_first and not billing_rows else ""),
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

        if is_single_date:
            rows.append(
                [
                    "",
                    "",
                    "",
                    "",
                    "",
                    f"Total Used\n{_quantity_with_unit(item.used_stock, item.unit)}",
                    "",
                    "",
                    "",  # purchase_rate
                    "",  # purchase_amount
                    "Subtotal",
                    _quantity_with_unit(item.assumption_quantity, item.unit),
                    _quantity_with_unit(item.sales_quantity, item.unit),
                    _quantity_with_unit(item.difference_quantity, item.unit),
                    _money(item.assumption_amount),
                    _money(item.sales_amount),
                    _money(item.difference_amount),
                ]
            )

    return rows


def _used_stock_breakdown_text(
    row: OverallReportUsedStockBreakdown | None,
    unit: BaseUnit,
) -> str:
    if row is None:
        return ""
    return f"{row.label}\n{_quantity_with_unit(row.quantity, unit)}"


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
        organization_id=context.organization_id,
        organization_name=context.organization_name,
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


# FPDF2-based Overall Report PDF (Tamil-safe)
# ─────────────────────────────────────────────────────────────────────────────


class OverallReportPDF(FPDF):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.set_margin(36)
        self.page_break_trigger = self.h - 54
        self.set_auto_page_break(False)

    def footer(self) -> None:
        self.set_y(-30)
        self.set_font("NotoSans", size=7)
        self.set_text_color(97, 110, 128)
        self.set_draw_color(209, 217, 227)
        self.line(36, self.h - 34, self.w - 36, self.h - 34)
        self.cell(0, 10, text="Billing System Admin Report", align="L")
        self.cell(0, 10, text=f"Page {self.page_no()}", align="R")


def _fpdf_set_cell_font(pdf: FPDF, text: str, *, is_header: bool) -> None:
    font_size = (
        OVER_REPORT_SHEET_HEADER_FONT_SIZE_FPDF
        if is_header
        else OVER_REPORT_SHEET_DATA_FONT_SIZE_FPDF
    )
    style = "B" if is_header else ""
    if _has_tamil_text(text):
        pdf.set_font("NotoSansTamil", style=style, size=font_size)
    else:
        pdf.set_font("NotoSans", style=style, size=font_size)


def _fpdf_wrap_cell_lines(
    pdf: FPDF, text: str, inner_width: float, *, is_header: bool
) -> list[str]:
    if not text:
        return [""]
    _fpdf_set_cell_font(pdf, text, is_header=is_header)
    if pdf.get_string_width(text) <= inner_width:
        return [text]
    words = text.split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        _fpdf_set_cell_font(pdf, candidate, is_header=is_header)
        if pdf.get_string_width(candidate) <= inner_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        _fpdf_set_cell_font(pdf, word, is_header=is_header)
        current = word if pdf.get_string_width(word) <= inner_width else ""
        if not current:
            lines.append(word)
    if current:
        lines.append(current)
    return lines or [""]


def _fpdf_cell_lines(
    pdf: FPDF,
    value: object,
    width: float,
    padding: float,
    *,
    is_header: bool,
) -> list[str]:
    text = str(value) if value is not None else ""
    if is_header:
        return [line for line in text.split("\n")] or [""]
    inner_width = max(8.0, width - padding * 2)
    lines: list[str] = []
    for segment in text.split("\n"):
        if not segment:
            lines.append("")
            continue
        lines.extend(_fpdf_wrap_cell_lines(pdf, segment, inner_width, is_header=False))
    return lines or [""]


def _fpdf_draw_row(
    pdf: FPDF,
    widths: list[int],
    alignments: list[str],
    row_values: list[object],
    line_height: float,
    padding: float,
    fill: bool = False,
    fill_color: tuple[int, int, int] = (255, 255, 255),
    is_header: bool = False,
    header_drawer: object = None,
) -> None:
    cell_lines = [
        _fpdf_cell_lines(pdf, val, w, padding, is_header=is_header)
        for val, w in zip(row_values, widths, strict=True)
    ]

    max_lines = max((len(lines) for lines in cell_lines), default=1)
    row_height = max_lines * line_height + padding * 2

    if not is_header and pdf.get_y() + row_height > pdf.page_break_trigger:
        pdf.add_page()
        if header_drawer:
            header_drawer()

    x_start = (pdf.w - sum(widths)) / 2
    pdf.set_x(x_start)
    y_start = pdf.get_y()

    current_x = x_start
    for lines, w, align in zip(cell_lines, widths, alignments, strict=True):
        if fill:
            pdf.set_fill_color(*fill_color)
            pdf.rect(current_x, y_start, w, row_height, style="DF")
        else:
            pdf.rect(current_x, y_start, w, row_height, style="D")

        align_code = "C" if is_header else (align[0].upper() if align else "L")
        block_height = line_height * len(lines)
        y_offset = padding + (row_height - padding * 2 - block_height) / 2
        for idx, line in enumerate(lines):
            _fpdf_set_cell_font(pdf, line, is_header=is_header)
            pdf.set_xy(current_x + padding, y_start + y_offset + idx * line_height)
            pdf.cell(w - padding * 2, line_height, text=line, align=align_code)

        current_x += w

    pdf.set_xy(x_start, y_start + row_height)


def _fpdf_draw_day_summary_card(
    pdf: FPDF,
    day_label: str,
    sales: Decimal,
    purchase: Decimal,
    expense: Decimal,
    balance: Decimal,
) -> None:
    card_width = 300
    card_height = 70
    x_start = (pdf.w - card_width) / 2
    y_start = pdf.get_y() + 5

    if y_start + card_height > pdf.page_break_trigger:
        pdf.add_page()
        y_start = pdf.get_y() + 5

    pdf.set_fill_color(244, 246, 248)
    pdf.set_draw_color(200, 205, 212)
    pdf.rect(x_start, y_start, card_width, card_height, style="DF")

    pdf.set_xy(x_start + 10, y_start + 6)
    pdf.set_font("NotoSans", style="B", size=8)
    pdf.cell(card_width - 20, 10, text=f"Day Summary ({day_label})")

    pdf.set_font("NotoSans", size=7.5)

    pdf.set_xy(x_start + 10, y_start + 20)
    pdf.cell(150, 8, text="Total Sales")
    pdf.set_xy(x_start + card_width - 110, y_start + 20)
    pdf.cell(100, 8, text=_money(sales), align="R")

    pdf.set_xy(x_start + 10, y_start + 30)
    pdf.cell(150, 8, text="Total Purchase")
    pdf.set_xy(x_start + card_width - 110, y_start + 30)
    pdf.cell(100, 8, text=_money(purchase), align="R")

    pdf.set_xy(x_start + 10, y_start + 40)
    pdf.cell(150, 8, text="Total Expense Amount")
    pdf.set_xy(x_start + card_width - 110, y_start + 40)
    pdf.cell(100, 8, text=_money(expense), align="R")

    pdf.set_xy(x_start + 10, y_start + 52)
    pdf.set_font("NotoSans", style="B", size=7.5)
    pdf.cell(150, 8, text="Balance Amount")
    pdf.set_xy(x_start + card_width - 110, y_start + 52)
    pdf.cell(100, 8, text=_money(balance), align="R")

    pdf.set_draw_color(200, 205, 212)
    pdf.set_xy(x_start, y_start + card_height + 5)


def _fpdf_draw_grand_total_summary(
    pdf: FPDF,
    total_sales: Decimal,
    total_purchase: Decimal,
    total_expense: Decimal,
    total_balance: Decimal,
    table_width: int = 798,
) -> None:
    fin_width = 250
    fin_height = 54

    x_start = (pdf.w - table_width) / 2 + table_width - fin_width
    y_start = pdf.get_y() + 8

    if y_start + fin_height > pdf.page_break_trigger:
        pdf.add_page()
        y_start = pdf.get_y() + 8

    pdf.set_fill_color(255, 255, 255)
    pdf.set_draw_color(200, 205, 212)
    pdf.rect(x_start, y_start, fin_width, fin_height, style="DF")

    pdf.set_xy(x_start + 10, y_start + 5)
    pdf.set_font("NotoSans", size=8)
    pdf.cell(120, 8, text="Total Sales")
    pdf.set_xy(x_start + fin_width - 110, y_start + 5)
    pdf.cell(100, 8, text=_money(total_sales), align="R")

    pdf.set_xy(x_start + 10, y_start + 15)
    pdf.cell(120, 8, text="Total Purchase")
    pdf.set_xy(x_start + fin_width - 110, y_start + 15)
    pdf.cell(100, 8, text=_money(total_purchase), align="R")

    pdf.set_xy(x_start + 10, y_start + 25)
    pdf.cell(120, 8, text="Total Expense Amount")
    pdf.set_xy(x_start + fin_width - 110, y_start + 25)
    pdf.cell(100, 8, text=_money(total_expense), align="R")

    pdf.set_xy(x_start + 10, y_start + 39)
    pdf.set_font("NotoSans", style="B", size=8)
    pdf.cell(120, 8, text="Balance Amount")
    pdf.set_xy(x_start + fin_width - 110, y_start + 39)
    pdf.cell(100, 8, text=_money(total_balance), align="R")

    pdf.set_xy(x_start, y_start + fin_height + 5)


async def _generate_over_report_fpdf_pdf(
    db: AsyncSession,
    context: ReportContext,
    language: str = "en",
) -> bytes:
    report = await _build_overall_report_for_context(db, context)
    use_tamil = language == "ta"
    period_start = context.start.date()
    period_end = (context.end - timedelta(days=1)).date()

    if period_start == period_end:
        date_label = _date_text(period_start)
    else:
        date_label = f"{_date_text(period_start)} To {_date_text(period_end)}"

    pdf = OverallReportPDF(orientation="landscape", unit="pt", format="A3")
    pdf.compress = False
    _register_fpdf_fonts(pdf)
    pdf.set_text_shaping(True)
    pdf.set_text_color(31, 39, 51)
    pdf.set_text_color(31, 39, 51)

    if not report.statements:
        pdf.add_page()
        pdf.set_font("NotoSans", style="B", size=14)
        pdf.cell(0, 20, text=_report_org_header(context), align="C", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("NotoSans", size=9)
        pdf.set_text_color(97, 110, 128)
        pdf.cell(0, 40, text="No branch data available for the selected report scope.", align="C")
        return bytes(pdf.output())

    shops_seen = {}
    for stmt in report.statements:
        key = str(stmt.shop_id)
        if key not in shops_seen:
            shops_seen[key] = (stmt.shop_name, [])
        shops_seen[key][1].append(stmt)

    for shop_id, (shop_name, statements) in shops_seen.items():
        pdf.add_page()

        pdf.set_font("NotoSans", style="B", size=14)
        pdf.cell(0, 18, text=_report_org_header(context), align="C", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("NotoSans", style="B", size=11)
        pdf.cell(
            0, 15, text=_report_branch_header(context, shop_name), align="C", new_x="LMARGIN", new_y="NEXT"
        )
        pdf.set_font("NotoSans", style="B", size=9)
        pdf.cell(0, 13, text="Statement", align="C", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("NotoSans", size=8)
        pdf.set_text_color(97, 110, 128)
        pdf.cell(0, 12, text=f"Date: {date_label}", align="C", new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(31, 39, 51)
        pdf.ln(10)

        has_any_items = any(bool(stmt.inventory_items) for stmt in statements)
        if not has_any_items:
            pdf.set_font("NotoSansTamil", size=9)
            pdf.set_text_color(97, 110, 128)
            pdf.cell(
                0,
                20,
                text="No allocated inventory items found for this branch and period.",
                align="C",
            )
            continue

        headers = _over_report_sheet_headers(use_tamil=use_tamil)
        sheet_rows = [
            row
            for stmt in statements
            for row in _over_report_sheet_rows(stmt.inventory_items, stmt, use_tamil=use_tamil)
        ]
        widths = _fpdf_over_report_sheet_widths(pdf, headers, sheet_rows)
        alignments = list(OVER_REPORT_SHEET_ALIGNMENTS)
        header_alignments = list(OVER_REPORT_SHEET_HEADER_ALIGNMENTS)

        def draw_header_row() -> None:
            pdf.set_font("NotoSans", style="B", size=6.5)
            pdf.set_text_color(255, 255, 255)
            pdf.set_draw_color(26, 37, 51)
            _fpdf_draw_row(
                pdf,
                widths,
                header_alignments,
                headers,
                line_height=7,
                padding=4,
                fill=True,
                fill_color=(46, 61, 82),
                is_header=True,
            )
            pdf.set_text_color(31, 39, 51)
            pdf.set_draw_color(200, 205, 212)

        draw_header_row()

        row_index = 0
        for stmt in statements:
            mapped_items = [i for i in stmt.inventory_items if i.billing_items]
            unmapped_items = [i for i in stmt.inventory_items if not i.billing_items]

            mapped_rows = _over_report_sheet_rows(mapped_items, stmt, use_tamil=use_tamil)
            unmapped_rows = _over_report_sheet_rows(unmapped_items, stmt, use_tamil=use_tamil)

            pdf.set_font("NotoSans", size=6)
            for row in mapped_rows:
                fill = row_index % 2 == 1
                _fpdf_draw_row(
                    pdf,
                    widths,
                    alignments,
                    row,
                    line_height=7,
                    padding=3,
                    fill=fill,
                    fill_color=(244, 246, 248),
                    header_drawer=draw_header_row,
                )
                row_index += 1

            if unmapped_rows:
                if mapped_rows or row_index > 0:
                    pdf.ln(8)

                pdf.set_font("NotoSans", style="B", size=8)
                pdf.set_text_color(31, 39, 51)
                pdf.cell(
                    sum(widths[:8]),
                    10,
                    text="No mapped billing Items",
                    align="C",
                    new_x="LMARGIN",
                    new_y="NEXT",
                )

                unmapped_widths = widths[:8]
                unmapped_alignments = alignments[:8]
                unmapped_header_alignments = header_alignments[:8]
                unmapped_headers = headers[:8]

                def draw_unmapped_header_row() -> None:
                    pdf.set_font("NotoSans", style="B", size=6.5)
                    pdf.set_text_color(255, 255, 255)
                    pdf.set_draw_color(26, 37, 51)
                    _fpdf_draw_row(
                        pdf,
                        unmapped_widths,
                        unmapped_header_alignments,
                        unmapped_headers,
                        line_height=7,
                        padding=4,
                        fill=True,
                        fill_color=(46, 61, 82),
                        is_header=True,
                    )
                    pdf.set_text_color(31, 39, 51)
                    pdf.set_draw_color(200, 205, 212)

                draw_unmapped_header_row()
                row_index = 0
                for row in unmapped_rows:
                    fill = row_index % 2 == 1
                    _fpdf_draw_row(
                        pdf,
                        unmapped_widths,
                        unmapped_alignments,
                        row[:8],
                        line_height=7,
                        padding=3,
                        fill=fill,
                        fill_color=(244, 246, 248),
                        header_drawer=draw_unmapped_header_row,
                    )
                    row_index += 1

            if stmt.inventory_items and period_start != period_end:
                day_label = _statement_table_date(stmt)
                day_sales = _decimal(stmt.sales_amount)
                day_purchase = _decimal(stmt.purchase_amount)
                day_expense = _decimal(stmt.expense_amount)
                day_balance = _over_report_balance_amount(day_sales, day_purchase, day_expense)
                _fpdf_draw_day_summary_card(
                    pdf, day_label, day_sales, day_purchase, day_expense, day_balance
                )

        total_sales = sum((_decimal(s.sales_amount) for s in statements), Decimal("0"))
        total_purchase = sum((_decimal(s.purchase_amount) for s in statements), Decimal("0"))
        total_expense = sum((_decimal(s.expense_amount) for s in statements), Decimal("0"))
        total_balance = _over_report_balance_amount(total_sales, total_purchase, total_expense)
        _fpdf_draw_grand_total_summary(
            pdf, total_sales, total_purchase, total_expense, total_balance, table_width=sum(widths)
        )

    return bytes(pdf.output())
