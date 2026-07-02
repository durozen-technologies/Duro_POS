from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_super_admin_context
from app.db.session import get_platform_db
from app.schemas.admin import AnalyticsPeriod
from app.schemas.super_admin.analytics import SuperAdminBillingOverviewRead
from app.services.super_admin import analytics as analytics_service

router = APIRouter()


@router.get("/analytics/billing-overview", response_model=SuperAdminBillingOverviewRead)
async def billing_overview(
    period: AnalyticsPeriod = "date",
    reference_date: date | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
    organization_id: UUID | None = Query(default=None),
    shop_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_platform_db),
    ctx=Depends(get_super_admin_context),
) -> SuperAdminBillingOverviewRead:
    return await analytics_service.get_billing_overview(
        db,
        period=period,
        reference_date=reference_date,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        organization_id=organization_id,
        shop_id=shop_id,
    )
