from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, status

from app.config import get_settings
from app.db import shop_scoped_session
from app.schemas import SalesSummaryResponse
from app.services.sales import get_sales_summary

router = APIRouter(prefix="/api/sales", tags=["sales"])


@router.get("/today", response_model=SalesSummaryResponse)
async def get_today_sales(
    shop_id: UUID = Query(...),
) -> SalesSummaryResponse:
    settings = get_settings()
    today = datetime.now(ZoneInfo(settings.app_timezone)).date()
    async with shop_scoped_session(shop_id) as session:
        return await get_sales_summary(
            session=session,
            shop_id=shop_id,
            from_date=today,
            to_date=today,
            timezone_name=settings.app_timezone,
        )


@router.get("/range", response_model=SalesSummaryResponse)
async def get_range_sales(
    shop_id: UUID = Query(...),
    from_date: date = Query(...),
    to_date: date = Query(...),
) -> SalesSummaryResponse:
    if to_date < from_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="to_date must be greater than or equal to from_date.",
        )

    settings = get_settings()
    async with shop_scoped_session(shop_id) as session:
        return await get_sales_summary(
            session=session,
            shop_id=shop_id,
            from_date=from_date,
            to_date=to_date,
            timezone_name=settings.app_timezone,
        )
