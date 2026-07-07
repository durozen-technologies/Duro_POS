from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from app.core.timezone import today_ist

from fastapi import HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tenant_schema import is_postgres_session, tenant_schema_scope
from app.models import Bill, Organization, Shop
from app.schemas.admin import AnalyticsPeriod
from app.schemas.super_admin.analytics import (
    SuperAdminBillingBranchRead,
    SuperAdminBillingOrganizationRead,
    SuperAdminBillingOverviewRead,
    SuperAdminBillingSummary,
)
from app.services.admin.catalogue import _get_period_bounds


async def _list_branch_bill_counts(
    db: AsyncSession,
    organization_id: UUID,
    *,
    start: datetime,
    end: datetime,
    shop_id: UUID | None = None,
) -> list[SuperAdminBillingBranchRead]:
    shop_filters = [Shop.organization_id == organization_id]
    if shop_id is not None:
        shop_filters.append(Shop.id == shop_id)

    result = await db.execute(
        select(
            Shop.id,
            Shop.name,
            Shop.is_active,
            func.count(Bill.id).label("bill_count"),
        )
        .outerjoin(
            Bill,
            and_(
                Bill.shop_id == Shop.id,
                Bill.created_at >= start,
                Bill.created_at < end,
            ),
        )
        .where(*shop_filters)
        .group_by(Shop.id)
        .order_by(func.count(Bill.id).desc(), Shop.name.asc())
    )
    return [
        SuperAdminBillingBranchRead(
            shop_id=row.id,
            shop_name=row.name,
            is_active=row.is_active,
            bill_count=int(row.bill_count or 0),
        )
        for row in result.all()
    ]


async def _count_bills_for_window(
    db: AsyncSession,
    organization_id: UUID,
    *,
    start: datetime,
    end: datetime,
    shop_id: UUID | None = None,
) -> int:
    filters = [
        Shop.organization_id == organization_id,
        Bill.created_at >= start,
        Bill.created_at < end,
    ]
    if shop_id is not None:
        filters.append(Shop.id == shop_id)

    return int(
        await db.scalar(
            select(func.count(Bill.id)).join(Shop, Shop.id == Bill.shop_id).where(*filters)
        )
        or 0
    )


async def _branch_rows_for_organization(
    db: AsyncSession,
    organization: Organization,
    *,
    start: datetime,
    end: datetime,
    today_start: datetime,
    today_end: datetime,
    shop_id: UUID | None,
    use_schema_tenant: bool,
) -> tuple[list[SuperAdminBillingBranchRead], int]:
    async def _fetch() -> tuple[list[SuperAdminBillingBranchRead], int]:
        branch_rows = await _list_branch_bill_counts(
            db,
            organization.id,
            start=start,
            end=end,
            shop_id=shop_id,
        )
        if shop_id is not None and not branch_rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")
        today_bill_count = (
            sum(branch.bill_count for branch in branch_rows)
            if start == today_start and end == today_end
            else await _count_bills_for_window(
                db,
                organization.id,
                start=today_start,
                end=today_end,
                shop_id=shop_id,
            )
        )
        return branch_rows, today_bill_count

    if use_schema_tenant and organization.schema_name:
        async with tenant_schema_scope(db, organization.schema_name):
            return await _fetch()
    return await _fetch()


async def get_billing_overview(
    db: AsyncSession,
    *,
    period: AnalyticsPeriod = "date",
    reference_date: date | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
    organization_id: UUID | None = None,
    shop_id: UUID | None = None,
) -> SuperAdminBillingOverviewRead:
    if shop_id is not None and organization_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="organization_id is required when shop_id is provided",
        )

    start, end = _get_period_bounds(period, reference_date, range_start_date, range_end_date)
    today_start, today_end = _get_period_bounds("date", today_ist())

    org_query = select(Organization).order_by(Organization.name.asc(), Organization.id.asc())
    if organization_id is not None:
        org_query = org_query.where(Organization.id == organization_id)
    organizations = list(await db.scalars(org_query))
    if organization_id is not None and not organizations:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    use_schema_tenant = await is_postgres_session(db)
    summary = SuperAdminBillingSummary()
    organization_rows: list[SuperAdminBillingOrganizationRead] = []

    for organization in organizations:
        branch_rows, today_bill_count = await _branch_rows_for_organization(
            db,
            organization,
            start=start,
            end=end,
            today_start=today_start,
            today_end=today_end,
            shop_id=shop_id,
            use_schema_tenant=use_schema_tenant,
        )

        total_bills_generated = sum(branch.bill_count for branch in branch_rows)
        summary.total_branches += len(branch_rows)
        summary.total_bills_generated += total_bills_generated
        summary.bills_generated_today += today_bill_count
        organization_rows.append(
            SuperAdminBillingOrganizationRead(
                organization_id=organization.id,
                organization_name=organization.name,
                organization_slug=organization.slug,
                is_active=organization.is_active,
                branch_count=len(branch_rows),
                total_bills_generated=total_bills_generated,
                branches=branch_rows,
            )
        )

    summary.total_organizations = len(organization_rows)
    organization_rows.sort(
        key=lambda row: (
            -row.total_bills_generated,
            row.organization_name.lower(),
            str(row.organization_id),
        )
    )
    return SuperAdminBillingOverviewRead(
        period=period,
        reference_date=None if period == "range" else (reference_date or today_ist()),
        range_start_date=range_start_date if period == "range" else None,
        range_end_date=range_end_date if period == "range" else None,
        summary=summary,
        organizations=organization_rows,
    )
