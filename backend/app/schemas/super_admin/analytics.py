from __future__ import annotations

from datetime import date
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.admin import AnalyticsPeriod


class SuperAdminBillingBranchRead(BaseModel):
    shop_id: UUID
    shop_name: str
    is_active: bool
    bill_count: int = 0


class SuperAdminBillingOrganizationRead(BaseModel):
    organization_id: UUID
    organization_name: str
    organization_slug: str
    is_active: bool
    branch_count: int = 0
    total_bills_generated: int = 0
    branches: list[SuperAdminBillingBranchRead] = Field(default_factory=list)


class SuperAdminBillingSummary(BaseModel):
    total_organizations: int = 0
    total_branches: int = 0
    total_bills_generated: int = 0
    bills_generated_today: int = 0


class SuperAdminBillingOverviewRead(BaseModel):
    period: AnalyticsPeriod
    reference_date: date | None = None
    range_start_date: date | None = None
    range_end_date: date | None = None
    summary: SuperAdminBillingSummary
    organizations: list[SuperAdminBillingOrganizationRead] = Field(default_factory=list)
