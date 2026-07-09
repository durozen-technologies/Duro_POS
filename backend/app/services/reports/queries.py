from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fpdf import FPDF
from sqlalchemy import and_, case, func, select
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
    InventoryMovement,
    InventoryMovementType,
    InventoryTransfer,
    Item,
    Retailer,
    RetailerInventoryUsage,
    RetailerItemPrice,
    RetailerPayment,
    RetailerSale,
    RetailerSaleItem,
    ShopInventoryAllocation,
    ShopRetailerAllocation,
)
from app.schemas.admin import (
    AdminReportDetailLevel,
    AnalyticsPeriod,
    OverallReportBillingItem,
    OverallReportInventoryItem,
    OverallReportRead,
    OverallReportStatement,
    OverallReportUnitSummary,
    OverallReportUsedStockBreakdown,
    OverallReportRetailer,
    OverallReportInventoryRetailerData,
    OverallReportBillingRetailerData,
)
from app.services.reports.pdf import *  # noqa: F403
from app.services.reports.pdf import (
    OVER_REPORT_SHEET_DATA_FONT_SIZE_FPDF,
    OVER_REPORT_SHEET_HEADER_FONT_SIZE_FPDF,
    ReportContext,
    _build_report_context,
    _date_text,
    _decimal,
    _fpdf_over_report_sheet_widths,
    _has_tamil_text,
    _inventory_category_labels_by_item_id,
    _money,
    _quantity_with_unit,
    _register_fpdf_fonts,
    _report_branch_header,
    _report_org_header,
    _reportlab_over_report_sheet_widths,
)


def _over_report_balance_amount(
    sales: Decimal | str | int | float,
    purchase: Decimal | str | int | float,
    expense: Decimal | str | int | float,
) -> Decimal:
    return _decimal(sales) - _decimal(purchase) - _decimal(expense)


def _over_report_profit_amount(
    sales: Decimal | str | int | float,
    retailer_paid: Decimal | str | int | float,
    purchase: Decimal | str | int | float,
    expense: Decimal | str | int | float,
) -> Decimal:
    return (
        _decimal(sales)
        + _decimal(retailer_paid)
        - _decimal(purchase)
        - _decimal(expense)
    )


def _total_retailer_inventory_used(item: OverallReportInventoryItem) -> Decimal:
    return sum((_decimal(entry.used_stock) for entry in item.retailer_data), Decimal("0"))


def _total_retailer_billing_value(
    billing_row: OverallReportBillingItem | None,
    field: str,
) -> Decimal:
    if billing_row is None:
        return Decimal("0")
    return sum(
        (_decimal(getattr(entry, field)) for entry in billing_row.retailer_data),
        Decimal("0"),
    )


def _item_total_retailer_billing_value(
    item: OverallReportInventoryItem,
    field: str,
) -> Decimal:
    return sum(
        (_total_retailer_billing_value(billing_row, field) for billing_row in item.billing_items),
        Decimal("0"),
    )


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
    active_retailers_query = (
        select(Retailer.id, Retailer.name)
        .join(ShopRetailerAllocation)
        .where(
            ShopRetailerAllocation.shop_id == shop_id,
            ShopRetailerAllocation.is_active == True,
            Retailer.is_active == True,
        )
        .order_by(Retailer.name)
    )
    retailers = [
        OverallReportRetailer(id=row.id, name=row.name)
        for row in (await db.execute(active_retailers_query)).all()
    ]

    inventory_items = await _overall_report_inventory_items(db, context, shop_id, retailers)
    await _populate_overall_report_used_stock_breakdown(db, context, shop_id, inventory_items)
    await _populate_overall_report_billing_items(db, context, shop_id, inventory_items, retailers)
    unit_summaries = _overall_report_unit_summaries(inventory_items.values())
    expense_cash_amount, expense_upi_amount, expense_amount = await _over_report_expense_amounts(
        db, context, shop_id
    )
    
    # Shop billing sales only (normal sales).
    sales_amount = sum(
        (_decimal(item.sales_amount) for item in inventory_items.values()),
        Decimal("0"),
    )
    
    retailer_paid_amount = await _over_report_retailer_paid_amount(db, context, shop_id)
    retailer_balance_amount = await _over_report_retailer_balance_amount(db, context, shop_id)

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

    profit_amount = _over_report_profit_amount(
        sales_amount,
        retailer_paid_amount,
        purchase_amount,
        expense_amount,
    )

    return OverallReportStatement(
        shop_id=shop_id,
        shop_name=shop_name,
        start_date=context.start.date(),
        end_date=(context.end - timedelta(days=1)).date(),
        period_label=context.period_label,
        unit_summaries=unit_summaries,
        expense_cash_amount=expense_cash_amount,
        expense_upi_amount=expense_upi_amount,
        expense_amount=expense_amount,
        sales_amount=sales_amount,
        retailer_paid_amount=retailer_paid_amount,
        retailer_balance_amount=retailer_balance_amount,
        profit_amount=profit_amount,
        assumption_amount=assumption_amount,
        purchase_amount=purchase_amount,
        difference_amount=difference_amount,
        sales_minus_expense_amount=sales_amount - expense_amount,
        sales_minus_assumption_amount=sales_amount - assumption_amount,
        inventory_items=list(inventory_items.values()),
        retailers=retailers,
    )


async def _overall_report_inventory_items(
    db: AsyncSession,
    context: ReportContext,
    shop_id: UUID,
    retailers: list[OverallReportRetailer],
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

    if retailers and items:
        retailer_used_stock_query = (
            select(
                RetailerInventoryUsage.inventory_item_id,
                RetailerInventoryUsage.retailer_id,
                func.coalesce(func.sum(RetailerInventoryUsage.quantity), 0).label("used_stock")
            )
            .where(
                RetailerInventoryUsage.shop_id == shop_id,
                RetailerInventoryUsage.occurred_at >= context.start,
                RetailerInventoryUsage.occurred_at < context.end,
                RetailerInventoryUsage.inventory_item_id.in_(list(items.keys()))
            )
            .group_by(RetailerInventoryUsage.inventory_item_id, RetailerInventoryUsage.retailer_id)
        )
        ru_rows = (await db.execute(retailer_used_stock_query)).all()
        ru_dict: dict[UUID, dict[UUID, Decimal]] = {}
        for ru in ru_rows:
            ru_dict.setdefault(ru.inventory_item_id, {})[ru.retailer_id] = _decimal(ru.used_stock)
        
        for item_id, item in items.items():
            r_data_list = []
            for r in retailers:
                used = ru_dict.get(item_id, {}).get(r.id, Decimal("0"))
                r_data_list.append(
                    OverallReportInventoryRetailerData(retailer_id=r.id, used_stock=used)
                )
            item.retailer_data = r_data_list

    for item in items.values():
        total_retailer_used = _total_retailer_inventory_used(item)
        item.remaining_stock = (
            item.total_available_stock
            - item.used_stock
            - total_retailer_used
            - item.transfer_stock
        )
        if item.purchase_rate is not None:
            item.purchase_amount = (
                item.used_stock + total_retailer_used + item.transfer_stock
            ) * item.purchase_rate
        else:
            item.purchase_amount = Decimal("0")

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
    retailers: list[OverallReportRetailer],
) -> None:
    if not inventory_items:
        return

    rs_dict: dict[UUID, dict[UUID, tuple[Decimal, Decimal]]] = {}
    rp_dict: dict[UUID, dict[UUID, Decimal]] = {}
    mru_dict: dict[tuple[UUID, UUID], dict[UUID, Decimal]] = {}

    if retailers:
        # 1. Retailer Sales
        rs_totals = (
            select(
                RetailerSale.retailer_id,
                RetailerSaleItem.item_id.label("billing_item_id"),
                func.coalesce(func.sum(RetailerSaleItem.quantity), 0).label("sales_quantity"),
                func.coalesce(func.sum(RetailerSaleItem.line_total), 0).label("sales_amount"),
            )
            .join(RetailerSale, RetailerSale.id == RetailerSaleItem.retailer_sale_id)
            .where(
                RetailerSale.shop_id == shop_id,
                RetailerSale.created_at >= context.start,
                RetailerSale.created_at < context.end,
            )
            .group_by(RetailerSale.retailer_id, RetailerSaleItem.item_id)
        )
        for rs in (await db.execute(rs_totals)).all():
            rs_dict.setdefault(rs.billing_item_id, {})[rs.retailer_id] = (
                _decimal(rs.sales_quantity), _decimal(rs.sales_amount)
            )

        # 2. Retailer Prices
        rp_latest = (
            select(
                RetailerItemPrice.retailer_id,
                RetailerItemPrice.item_id.label("billing_item_id"),
                RetailerItemPrice.price_per_unit.label("today_price"),
                func.row_number()
                .over(
                    partition_by=(RetailerItemPrice.retailer_id, RetailerItemPrice.item_id),
                    order_by=(
                        RetailerItemPrice.effective_date.desc(),
                        RetailerItemPrice.id.desc(),
                    ),
                )
                .label("rn"),
            )
            .where(RetailerItemPrice.shop_id == shop_id)
            .subquery()
        )
        for rp in (await db.execute(select(rp_latest).where(rp_latest.c.rn == 1))).all():
            rp_dict.setdefault(rp.billing_item_id, {})[rp.retailer_id] = _decimal(rp.today_price)

        # 3. Retailer Mapped Used Stock
        mru_query = (
            select(
                RetailerInventoryUsage.inventory_item_id,
                RetailerInventoryUsage.category_id,
                RetailerInventoryUsage.retailer_id,
                func.coalesce(func.sum(RetailerInventoryUsage.quantity), 0).label("used_stock"),
            )
            .where(
                RetailerInventoryUsage.shop_id == shop_id,
                RetailerInventoryUsage.occurred_at >= context.start,
                RetailerInventoryUsage.occurred_at < context.end,
                RetailerInventoryUsage.category_id.is_not(None),
            )
            .group_by(RetailerInventoryUsage.inventory_item_id, RetailerInventoryUsage.category_id, RetailerInventoryUsage.retailer_id)
        )
        for mru in (await db.execute(mru_query)).all():
            mru_dict.setdefault((mru.inventory_item_id, mru.category_id), {})[mru.retailer_id] = _decimal(mru.used_stock)


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
        assumption_amount = (
            assumption_quantity * today_price if today_price is not None else Decimal("0")
        )

        r_data_list = []
        for r in retailers:
            r_sales_qty, r_sales_amt = rs_dict.get(row.billing_item_id, {}).get(r.id, (Decimal("0"), Decimal("0")))
            r_price = rp_dict.get(row.billing_item_id, {}).get(r.id)

            if row.inventory_category_id is not None:
                r_used_source = mru_dict.get((row.inventory_item_id, row.inventory_category_id), {}).get(r.id, Decimal("0"))
            else:
                r_inv_data = next((d for d in inventory_item.retailer_data if d.retailer_id == r.id), None)
                r_used_source = r_inv_data.used_stock if r_inv_data else Decimal("0")
            
            r_assumption_qty = r_used_source * _decimal(assumption_percent) / Decimal("100") if assumption_percent is not None else Decimal("0")
            r_assumption_amt = r_assumption_qty * r_price if r_price is not None else Decimal("0")
            
            r_data_list.append(OverallReportBillingRetailerData(
                retailer_id=r.id,
                assumption_quantity=r_assumption_qty,
                sales_quantity=r_sales_qty,
                assumption_amount=r_assumption_amt,
                sales_amount=r_sales_amt
            ))

        total_retailer_assumption_qty = sum(
            (entry.assumption_quantity for entry in r_data_list),
            Decimal("0"),
        )
        total_retailer_sales_qty = sum(
            (entry.sales_quantity for entry in r_data_list),
            Decimal("0"),
        )
        total_retailer_assumption_amt = sum(
            (entry.assumption_amount for entry in r_data_list),
            Decimal("0"),
        )
        total_retailer_sales_amt = sum(
            (entry.sales_amount for entry in r_data_list),
            Decimal("0"),
        )
        difference_quantity = (assumption_quantity + total_retailer_assumption_qty) - (
            sales_quantity + total_retailer_sales_qty
        )
        difference_amount = (assumption_amount + total_retailer_assumption_amt) - (
            sales_amount + total_retailer_sales_amt
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
                retailer_data=r_data_list,
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

    from app.services.reports.pdf import get_over_report_sheet_config
    headers, min_widths, aligns, h_aligns, p1_idx, p2_idx = get_over_report_sheet_config(use_tamil, statement.retailers)
    sheet_headers = headers
    inventory_headers = [headers[i] for i in p1_idx]
    inventory_aligns = [aligns[i] for i in p1_idx]
    inventory_min_widths = [min_widths[i] for i in p1_idx]

    mapped_items = [i for i in statement.inventory_items if i.billing_items]
    unmapped_items = [i for i in statement.inventory_items if not i.billing_items]

    all_rows = _over_report_sheet_rows(statement.inventory_items, statement, use_tamil=use_tamil)
    mapped_rows = _over_report_sheet_rows(mapped_items, statement, use_tamil=use_tamil)
    unmapped_rows = _over_report_sheet_rows(unmapped_items, statement, use_tamil=use_tamil)

    sheet_widths = _reportlab_over_report_sheet_widths(
        sheet_headers,
        writer._available_width,
        min_widths,
        all_rows,
    )

    if mapped_rows:
        writer.sheet_table(
            sheet_headers,
            mapped_rows,
            sheet_widths,
            aligns,
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
            writer._margin + sum(sheet_widths[i] for i in p1_idx) / 2, writer._y - 12, title
        )
        writer._y -= 20

        inventory_widths = _reportlab_over_report_sheet_widths(
            inventory_headers,
            writer._available_width,
            inventory_min_widths,
            [[row[i] for i in p1_idx] for row in unmapped_rows],
        )
        writer.sheet_table(
            inventory_headers,
            [[row[i] for i in p1_idx] for row in unmapped_rows],
            inventory_widths,
            inventory_aligns,
        )

    if statement.inventory_items:
        writer.financial_summary(
            [
                ("Total Sales", _money(statement.sales_amount)),
                ("Total Retailer Paid Amount", _money(statement.retailer_paid_amount)),
                ("Total Purchase", _money(statement.purchase_amount)),
                ("Total Expense (Cash)", _money(statement.expense_cash_amount)),
                ("Total Expense (UPI)", _money(statement.expense_upi_amount)),
                ("Total Expense Amount", _money(statement.expense_amount)),
                ("Profit Amount", _money(statement.profit_amount)),
                ("Retailer Balance Amount", _money(statement.retailer_balance_amount)),
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

            row_data = [
                printed_date,
                inv_display_name if is_first else "",
                _quantity_with_unit(item.old_stock, item.unit) if is_first else "",
                _quantity_with_unit(item.adding_stock, item.unit) if is_first else "",
                _quantity_with_unit(item.total_available_stock, item.unit) if is_first else "",
                _used_stock_breakdown_text(used_row, item.unit),
                _quantity_with_unit(_total_retailer_inventory_used(item), item.unit)
                if is_first
                else "",
                _quantity_with_unit(item.transfer_stock, item.unit) if is_first else "",
                _quantity_with_unit(item.remaining_stock, item.unit),
                _money(item.purchase_rate) if is_first and item.purchase_rate is not None else "",
                _money(item.purchase_amount) if is_first else "",
                billing_display_name
                if billing_row is not None
                else ("No mapped billing sales" if is_first and not billing_rows else ""),
                _quantity_with_unit(billing_row.assumption_quantity, billing_row.unit)
                if billing_row is not None
                else "",
                _quantity_with_unit(
                    _total_retailer_billing_value(billing_row, "assumption_quantity"),
                    billing_row.unit,
                )
                if billing_row is not None
                else "",
                _quantity_with_unit(billing_row.sales_quantity, billing_row.unit)
                if billing_row is not None
                else "",
                _quantity_with_unit(
                    _total_retailer_billing_value(billing_row, "sales_quantity"),
                    billing_row.unit,
                )
                if billing_row is not None
                else "",
                _quantity_with_unit(billing_row.difference_quantity, billing_row.unit)
                if billing_row is not None
                else "",
                _money(billing_row.assumption_amount) if billing_row is not None else "",
                _money(_total_retailer_billing_value(billing_row, "assumption_amount"))
                if billing_row is not None
                else "",
                _money(billing_row.sales_amount) if billing_row is not None else "",
                _money(_total_retailer_billing_value(billing_row, "sales_amount"))
                if billing_row is not None
                else "",
                _money(billing_row.difference_amount) if billing_row is not None else "",
            ]

            rows.append(row_data)

        if is_single_date:
            row_data = [
                "",
                "",
                "",
                "",
                "",
                f"Total Used\n{_quantity_with_unit(item.used_stock, item.unit)}",
                f"Total Used\n{_quantity_with_unit(_total_retailer_inventory_used(item), item.unit)}",
                "",
                "",
                "",
                "",
                "Subtotal",
                _quantity_with_unit(item.assumption_quantity, item.unit),
                _quantity_with_unit(
                    _item_total_retailer_billing_value(item, "assumption_quantity"),
                    item.unit,
                ),
                _quantity_with_unit(item.sales_quantity, item.unit),
                _quantity_with_unit(
                    _item_total_retailer_billing_value(item, "sales_quantity"),
                    item.unit,
                ),
                _quantity_with_unit(item.difference_quantity, item.unit),
                _money(item.assumption_amount),
                _money(_item_total_retailer_billing_value(item, "assumption_amount")),
                _money(item.sales_amount),
                _money(_item_total_retailer_billing_value(item, "sales_amount")),
                _money(item.difference_amount),
            ]
            rows.append(row_data)

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
        retailer_ids=context.retailer_ids,
    )


async def _over_report_expense_amounts(
    db: AsyncSession,
    context: ReportContext,
    shop_id: UUID,
) -> tuple[Decimal, Decimal, Decimal]:
    row = (
        await db.execute(
            select(
                func.coalesce(func.sum(ExpenseEntry.cash_amount), Decimal("0.00")).label("expense_cash_amount"),
                func.coalesce(func.sum(ExpenseEntry.upi_amount), Decimal("0.00")).label("expense_upi_amount"),
                func.coalesce(func.sum(ExpenseEntry.amount), Decimal("0.00")).label("expense_amount"),
            ).where(
            ExpenseEntry.shop_id == shop_id,
            ExpenseEntry.spent_at >= context.start,
            ExpenseEntry.spent_at < context.end,
        )
        )
    ).one()
    return (
        _decimal(row.expense_cash_amount).quantize(Decimal("0.01")),
        _decimal(row.expense_upi_amount).quantize(Decimal("0.01")),
        _decimal(row.expense_amount).quantize(Decimal("0.01")),
    )


async def _over_report_retailer_paid_amount(
    db: AsyncSession,
    context: ReportContext,
    shop_id: UUID,
) -> Decimal:
    total = await db.scalar(
        select(func.coalesce(func.sum(RetailerPayment.total_paid), Decimal("0.00")))
        .join(RetailerSale, RetailerSale.id == RetailerPayment.retailer_sale_id)
        .where(
            RetailerSale.shop_id == shop_id,
            RetailerPayment.paid_at >= context.start,
            RetailerPayment.paid_at < context.end,
        )
    )
    return _decimal(total).quantize(Decimal("0.01"))


async def _over_report_retailer_balance_amount(
    db: AsyncSession,
    context: ReportContext,
    shop_id: UUID,
) -> Decimal:
    total = await db.scalar(
        select(func.coalesce(func.sum(RetailerSale.balance_due), Decimal("0.00"))).where(
            RetailerSale.shop_id == shop_id,
            RetailerSale.created_at >= context.start,
            RetailerSale.created_at < context.end,
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


def _fpdf_set_cell_font(
    pdf: FPDF,
    text: str,
    *,
    is_header: bool,
    font_size: float | None = None,
) -> None:
    size = font_size
    if size is None:
        size = (
            OVER_REPORT_SHEET_HEADER_FONT_SIZE_FPDF
            if is_header
            else OVER_REPORT_SHEET_DATA_FONT_SIZE_FPDF
        )
    style = "B" if is_header else ""
    if _has_tamil_text(text):
        pdf.set_font("NotoSansTamil", style=style, size=size)
    else:
        pdf.set_font("NotoSans", style=style, size=size)


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


def _fpdf_fit_token_lines(
    pdf: FPDF,
    token: str,
    inner_width: float,
    *,
    is_header: bool,
    font_size: float | None = None,
) -> list[str]:
    _fpdf_set_cell_font(pdf, token, is_header=is_header, font_size=font_size)
    if pdf.get_string_width(token) <= inner_width:
        return [token]
    lines: list[str] = []
    chunk = ""
    for char in token:
        candidate = f"{chunk}{char}"
        _fpdf_set_cell_font(pdf, candidate, is_header=is_header, font_size=font_size)
        if pdf.get_string_width(candidate) <= inner_width:
            chunk = candidate
            continue
        if chunk:
            lines.append(chunk)
        chunk = char
    if chunk:
        lines.append(chunk)
    return lines or [""]


def _fpdf_vertical_cell_lines(
    pdf: FPDF,
    text: str,
    inner_width: float,
    *,
    is_header: bool,
    font_size: float | None = None,
) -> list[str]:
    lines: list[str] = []
    for segment in text.split("\n"):
        segment = segment.strip()
        if not segment:
            lines.append("")
            continue
        _fpdf_set_cell_font(pdf, segment, is_header=is_header, font_size=font_size)
        if pdf.get_string_width(segment) <= inner_width:
            lines.append(segment)
            continue
        for word in segment.split():
            word = word.strip()
            if not word:
                continue
            if is_header:
                lines.extend(
                    _fpdf_fit_token_lines(
                        pdf,
                        word,
                        inner_width,
                        is_header=True,
                        font_size=font_size,
                    )
                )
            else:
                _fpdf_set_cell_font(pdf, word, is_header=False)
                if pdf.get_string_width(word) <= inner_width:
                    lines.append(word)
                else:
                    lines.extend(
                        _fpdf_fit_token_lines(
                            pdf,
                            word,
                            inner_width,
                            is_header=False,
                        )
                    )
    return lines or [""]


def _fpdf_vertical_header_cell_lines(
    pdf: FPDF,
    text: str,
    width: float,
    padding: float,
    *,
    font_size: float | None = None,
) -> list[str]:
    inner_width = max(8.0, width - padding * 2)
    return _fpdf_vertical_cell_lines(
        pdf,
        text,
        inner_width,
        is_header=True,
        font_size=font_size,
    )


def _fpdf_cell_lines(
    pdf: FPDF,
    value: object,
    width: float,
    padding: float,
    *,
    is_header: bool,
    header_font_size: float | None = None,
) -> list[str]:
    text = str(value) if value is not None else ""
    inner_width = max(8.0, width - padding * 2)
    if is_header:
        return _fpdf_vertical_header_cell_lines(
            pdf,
            text,
            width,
            padding,
            font_size=header_font_size,
        )
    lines: list[str] = []
    for segment in text.split("\n"):
        if not segment:
            lines.append("")
            continue
        _fpdf_set_cell_font(pdf, segment, is_header=False)
        if pdf.get_string_width(segment) <= inner_width:
            lines.append(segment)
            continue
        lines.extend(
            _fpdf_vertical_cell_lines(
                pdf,
                segment,
                inner_width,
                is_header=False,
            )
        )
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
    *,
    bold_borders: bool = False,
    header_font_size: float | None = None,
) -> None:
    cell_lines = [
        _fpdf_cell_lines(
            pdf,
            val,
            w,
            padding,
            is_header=is_header,
            header_font_size=header_font_size,
        )
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

    border_color = (31, 39, 51) if bold_borders else (200, 205, 212)
    border_width = 1.4 if bold_borders else 0.8
    pdf.set_line_width(border_width)
    pdf.set_draw_color(*border_color)

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
            _fpdf_set_cell_font(
                pdf,
                line,
                is_header=is_header,
                font_size=header_font_size if is_header else None,
            )
            pdf.set_xy(current_x + padding, y_start + y_offset + idx * line_height)
            pdf.cell(w - padding * 2, line_height, text=line, align=align_code)

        current_x += w

    pdf.set_xy(x_start, y_start + row_height)


OVER_REPORT_HIGHLIGHT_FILL = (255, 244, 196)


def _fpdf_row_is_highlight_row(row_values: list[object]) -> bool:
    for value in row_values:
        text = str(value).strip()
        if text == "Subtotal":
            return True
        if text == "Total Used" or text.startswith("Total Used\n"):
            return True
    return False


def _fpdf_draw_day_summary_card(
    pdf: FPDF,
    day_label: str,
    sales: Decimal,
    retailer_paid: Decimal,
    purchase: Decimal,
    expense: Decimal,
    profit: Decimal,
    retailer_balance: Decimal,
) -> None:
    card_width = 400
    card_height = 168
    x_start = (pdf.w - card_width) / 2
    y_start = pdf.get_y() + 5

    if y_start + card_height > pdf.page_break_trigger:
        pdf.add_page()
        y_start = pdf.get_y() + 5

    pdf.set_fill_color(244, 246, 248)
    pdf.set_draw_color(200, 205, 212)
    pdf.rect(x_start, y_start, card_width, card_height, style="DF")

    pdf.set_xy(x_start + 10, y_start + 8)
    pdf.set_font("NotoSans", style="B", size=14)
    pdf.cell(card_width - 20, 10, text=f"Day Summary ({day_label})")

    pdf.set_font("NotoSans", size=12)

    summary_rows = [
        ("Total Sales", _money(sales)),
        ("Total Retailer Paid Amount", _money(retailer_paid)),
        ("Total Purchase", _money(purchase)),
        ("Total Expense Amount", _money(expense)),
        ("Profit Amount", _money(profit)),
        ("Retailer Balance Amount", _money(retailer_balance)),
    ]
    y = y_start + 28
    for label, value in summary_rows:
        pdf.set_xy(x_start + 10, y)
        pdf.cell(200, 12, text=label)
        pdf.set_xy(x_start + card_width - 160, y)
        is_profit = label == "Profit Amount"
        if is_profit:
            pdf.set_font("NotoSans", style="B", size=12)
        pdf.cell(150, 12, text=value, align="R")
        if is_profit:
            pdf.set_font("NotoSans", size=12)
        y += 18

    pdf.set_draw_color(200, 205, 212)
    pdf.set_xy(x_start, y_start + card_height + 5)


def _fpdf_draw_grand_total_summary(
    pdf: FPDF,
    total_sales: Decimal,
    total_retailer_paid: Decimal,
    total_purchase: Decimal,
    total_expense: Decimal,
    total_profit: Decimal,
    total_retailer_balance: Decimal,
    table_width: int = 798,
) -> None:
    fin_width = 400
    fin_height = 150

    x_start = (pdf.w - table_width) / 2 + table_width - fin_width
    y_start = pdf.get_y() + 8

    if y_start + fin_height > pdf.page_break_trigger:
        pdf.add_page()
        y_start = pdf.get_y() + 8

    pdf.set_fill_color(255, 255, 255)
    pdf.set_draw_color(200, 205, 212)
    pdf.rect(x_start, y_start, fin_width, fin_height, style="DF")

    pdf.set_xy(x_start + 10, y_start + 10)
    pdf.set_font("NotoSans", size=12)
    summary_rows = [
        ("Total Sales", _money(total_sales)),
        ("Total Retailer Paid Amount", _money(total_retailer_paid)),
        ("Total Purchase", _money(total_purchase)),
        ("Total Expense Amount", _money(total_expense)),
        ("Profit Amount", _money(total_profit)),
        ("Retailer Balance Amount", _money(total_retailer_balance)),
    ]
    y = y_start + 10
    for label, value in summary_rows:
        pdf.set_xy(x_start + 10, y)
        pdf.cell(200, 12, text=label)
        pdf.set_xy(x_start + fin_width - 160, y)
        if label == "Profit Amount":
            pdf.set_font("NotoSans", style="B", size=12)
        pdf.cell(150, 12, text=value, align="R")
        if label == "Profit Amount":
            pdf.set_font("NotoSans", size=12)
        y += 18

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
            0,
            15,
            text=_report_branch_header(context, shop_name),
            align="C",
            new_x="LMARGIN",
            new_y="NEXT",
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

        from app.services.reports.pdf import get_over_report_sheet_config
        retailers = statements[0].retailers if statements else []
        headers, min_widths, aligns, h_aligns, part1_indices, part2_indices = get_over_report_sheet_config(use_tamil, retailers)
        
        sheet_rows = [
            row
            for stmt in statements
            for row in _over_report_sheet_rows(stmt.inventory_items, stmt, use_tamil=use_tamil)
        ]

        headers1 = [headers[i] for i in part1_indices]
        headers2 = [headers[i] for i in part2_indices]

        rows1 = [[row[i] for i in part1_indices] for row in sheet_rows]
        rows2 = [[row[i] for i in part2_indices] for row in sheet_rows]

        min_widths1 = tuple(min_widths[i] for i in part1_indices)
        min_widths2 = tuple(min_widths[i] for i in part2_indices)

        widths1 = _fpdf_over_report_sheet_widths(pdf, headers1, min_widths1, rows=rows1)
        widths2 = _fpdf_over_report_sheet_widths(pdf, headers2, min_widths2, rows=rows2)

        alignments1 = [aligns[i] for i in part1_indices]
        alignments2 = [aligns[i] for i in part2_indices]
        header_alignments1 = [h_aligns[i] for i in part1_indices]
        header_alignments2 = [h_aligns[i] for i in part2_indices]

        def draw_header_row1() -> None:
            pdf.set_text_color(255, 255, 255)
            _fpdf_draw_row(
                pdf,
                widths1,
                header_alignments1,
                headers1,
                line_height=10,
                padding=4,
                fill=True,
                fill_color=(46, 61, 82),
                is_header=True,
                bold_borders=True,
                header_font_size=8.0,
            )
            pdf.set_text_color(31, 39, 51)
            pdf.set_draw_color(31, 39, 51)

        def draw_header_row2() -> None:
            pdf.set_text_color(255, 255, 255)
            _fpdf_draw_row(
                pdf,
                widths2,
                header_alignments2,
                headers2,
                line_height=10,
                padding=4,
                fill=True,
                fill_color=(46, 61, 82),
                is_header=True,
                bold_borders=True,
                header_font_size=8.0,
            )
            pdf.set_text_color(31, 39, 51)
            pdf.set_draw_color(31, 39, 51)

        # Part 1
        pdf.set_font("NotoSans", style="B", size=14)
        pdf.cell(0, 10, text="Part 1: Inventory Details", align="L", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)
        draw_header_row1()

        row_index = 0
        for stmt in statements:
            mapped_items = [i for i in stmt.inventory_items if i.billing_items]
            unmapped_items = [i for i in stmt.inventory_items if not i.billing_items]

            mapped_rows = _over_report_sheet_rows(mapped_items, stmt, use_tamil=use_tamil)
            unmapped_rows = _over_report_sheet_rows(unmapped_items, stmt, use_tamil=use_tamil)

            pdf.set_font("NotoSans", size=12)
            for row in mapped_rows:
                part1_row = [row[i] for i in part1_indices]
                is_highlight = _fpdf_row_is_highlight_row(part1_row)
                fill = is_highlight or row_index % 2 == 1
                fill_color = OVER_REPORT_HIGHLIGHT_FILL if is_highlight else (244, 246, 248)
                _fpdf_draw_row(
                    pdf,
                    widths1,
                    alignments1,
                    part1_row,
                    line_height=14,
                    padding=4,
                    fill=fill,
                    fill_color=fill_color,
                    header_drawer=draw_header_row1,
                    bold_borders=True,
                )
                row_index += 1

            if unmapped_rows:
                if mapped_rows or row_index > 0:
                    pdf.ln(8)
                pdf.set_font("NotoSans", style="B", size=11)
                pdf.set_text_color(31, 39, 51)
                pdf.cell(
                    sum(widths1),
                    10,
                    text="No mapped billing Items",
                    align="C",
                    new_x="LMARGIN",
                    new_y="NEXT",
                )

                unmapped_widths = widths1
                unmapped_alignments = alignments1
                unmapped_header_alignments = header_alignments1
                unmapped_headers = headers1

                def draw_unmapped_header_row1() -> None:
                    pdf.set_text_color(255, 255, 255)
                    _fpdf_draw_row(
                        pdf,
                        unmapped_widths,
                        unmapped_header_alignments,
                        unmapped_headers,
                        line_height=10,
                        padding=4,
                        fill=True,
                        fill_color=(46, 61, 82),
                        is_header=True,
                        bold_borders=True,
                        header_font_size=8.0,
                    )
                    pdf.set_text_color(31, 39, 51)
                    pdf.set_draw_color(31, 39, 51)

                draw_unmapped_header_row1()
                row_index = 0
                for row in unmapped_rows:
                    part1_row = [row[i] for i in part1_indices]
                    is_highlight = _fpdf_row_is_highlight_row(part1_row)
                    fill = is_highlight or row_index % 2 == 1
                    fill_color = OVER_REPORT_HIGHLIGHT_FILL if is_highlight else (244, 246, 248)
                    _fpdf_draw_row(
                        pdf,
                        unmapped_widths,
                        unmapped_alignments,
                        part1_row,
                        line_height=14,
                        padding=4,
                        fill=fill,
                        fill_color=fill_color,
                        header_drawer=draw_unmapped_header_row1,
                        bold_borders=True,
                    )
                    row_index += 1

        # Part 2
        pdf.ln(10)
        pdf.set_font("NotoSans", style="B", size=14)
        pdf.cell(
            0, 10, text="Part 2: Billing & Sales Details", align="L", new_x="LMARGIN", new_y="NEXT"
        )
        pdf.ln(2)
        draw_header_row2()
        row_index = 0
        for stmt in statements:
            mapped_items = [i for i in stmt.inventory_items if i.billing_items]
            mapped_rows = _over_report_sheet_rows(mapped_items, stmt, use_tamil=use_tamil)

            pdf.set_font("NotoSans", size=11)
            for row in mapped_rows:
                part2_row = [row[i] for i in part2_indices]
                is_highlight = _fpdf_row_is_highlight_row(part2_row)
                fill = is_highlight or row_index % 2 == 1
                fill_color = OVER_REPORT_HIGHLIGHT_FILL if is_highlight else (244, 246, 248)
                _fpdf_draw_row(
                    pdf,
                    widths2,
                    alignments2,
                    part2_row,
                    line_height=13,
                    padding=4,
                    fill=fill,
                    fill_color=fill_color,
                    header_drawer=draw_header_row2,
                    bold_borders=True,
                )
                row_index += 1

            if stmt.inventory_items and period_start != period_end:
                day_label = _statement_table_date(stmt)
                day_sales = _decimal(stmt.sales_amount)
                day_retailer_paid = _decimal(stmt.retailer_paid_amount)
                day_purchase = _decimal(stmt.purchase_amount)
                day_expense = _decimal(stmt.expense_amount)
                day_profit = _decimal(stmt.profit_amount)
                day_retailer_balance = _decimal(stmt.retailer_balance_amount)
                _fpdf_draw_day_summary_card(
                    pdf,
                    day_label,
                    day_sales,
                    day_retailer_paid,
                    day_purchase,
                    day_expense,
                    day_profit,
                    day_retailer_balance,
                )

        total_sales = sum((_decimal(s.sales_amount) for s in statements), Decimal("0"))
        total_retailer_paid = sum((_decimal(s.retailer_paid_amount) for s in statements), Decimal("0"))
        total_purchase = sum((_decimal(s.purchase_amount) for s in statements), Decimal("0"))
        total_expense = sum((_decimal(s.expense_amount) for s in statements), Decimal("0"))
        total_profit = sum((_decimal(s.profit_amount) for s in statements), Decimal("0"))
        total_retailer_balance = sum(
            (_decimal(s.retailer_balance_amount) for s in statements),
            Decimal("0"),
        )
        _fpdf_draw_grand_total_summary(
            pdf,
            total_sales,
            total_retailer_paid,
            total_purchase,
            total_expense,
            total_profit,
            total_retailer_balance,
            table_width=sum(widths1),
        )

    return bytes(pdf.output())
