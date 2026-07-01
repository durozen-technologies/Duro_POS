from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal, shop_scoped_session
from app.tenant_db import list_shops_across_tenants


async def list_active_branches(session: AsyncSession) -> list[BranchRead]:
    shops = await list_shops_across_tenants(session)
    return [BranchRead.model_validate(shop) for shop in shops]


def build_datetime_window(
    from_date: date,
    to_date: date,
    timezone_name: str,
) -> tuple[datetime, datetime]:
    timezone = ZoneInfo(timezone_name)
    start = datetime.combine(from_date, time.min, tzinfo=timezone)
    end = datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=timezone)
    return start, end


async def get_sales_summary(
    session: AsyncSession,
    shop_id,
    from_date: date,
    to_date: date,
    timezone_name: str,
) -> SalesSummaryResponse:
    shop = await session.scalar(
        select(Shop).where(Shop.id == shop_id, Shop.is_active.is_(True))
    )
    if shop is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Active branch not found.",
        )

    start_at, end_at = build_datetime_window(from_date, to_date, timezone_name)
    result = await session.execute(
        select(
            Item.id.label("item_id"),
            Item.name.label("item_name"),
            BillItem.unit.label("unit"),
            func.sum(BillItem.quantity).label("total_quantity"),
            func.sum(BillItem.line_total).label("total_revenue"),
        )
        .join(BillItem, BillItem.item_id == Item.id)
        .join(Bill, Bill.id == BillItem.bill_id)
        .where(
            Bill.shop_id == shop_id,
            Bill.created_at >= start_at,
            Bill.created_at < end_at,
        )
        .group_by(Item.id, Item.name, BillItem.unit)
        .order_by(Item.name.asc())
    )

    items = [
        SalesSummaryItem(
            item_id=row.item_id,
            item_name=row.item_name,
            total_quantity=row.total_quantity,
            unit=row.unit,
            total_revenue=row.total_revenue,
        )
        for row in result.all()
    ]

    return SalesSummaryResponse(
        shop_id=shop.id,
        shop_name=shop.name,
        from_date=from_date,
        to_date=to_date,
        items=items,
    )
