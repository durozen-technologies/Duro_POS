"""Shared query params, dependencies, and multipart parsers for admin routes."""

import json
from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_admin, get_tenant_shop_or_404
from app.db.tenant_session import get_tenant_db
from app.models import Shop, User
from app.schemas.admin import (
    AdminReportDetailLevel,
    AdminReportSection,
    AnalyticsPeriod,
    ItemScope,
    PriceStatus,
)
from app.schemas.inventory import InventoryBillingItemMappingWrite

AnalyticsPeriodParam = Annotated[
    AnalyticsPeriod,
    Query(description="Aggregation window: `date`, `month`, `week`, `year`, or `range`."),
]
ReferenceDateParam = Annotated[
    date | None,
    Query(description="Anchor date used to resolve the selected period."),
]
RangeStartDateParam = Annotated[
    date | None,
    Query(description="Inclusive start date when period is `range`."),
]
RangeEndDateParam = Annotated[
    date | None,
    Query(description="Inclusive end date when period is `range`."),
]
ShopIdParam = Annotated[
    UUID | None,
    Query(description="Filter results to a single shop branch."),
]
ShopIdsParam = Annotated[
    list[UUID] | None,
    Query(description="Filter reports to one or more shop branches. Omit for all branches."),
]
PriceHistoryDateParam = Annotated[
    date,
    Query(description="Exact price date to look up for a shop branch."),
]
ReportSectionsParam = Annotated[
    list[AdminReportSection],
    Query(description="Report sections to include. Repeat for multiple values."),
]
ReportDetailLevelParam = Annotated[
    AdminReportDetailLevel,
    Query(description="Report detail level: summary or full."),
]
ReportLanguageParam = Annotated[
    str,
    Query(description="Language for PDF content: en (English) or ta (Tamil)."),
]
BillsLimitParam = Annotated[
    int,
    Query(ge=1, le=500, description="Maximum number of bills returned in one page."),
]
ItemsLimitParam = Annotated[
    int,
    Query(ge=1, le=500, description="Maximum number of items to return."),
]
ItemSearchParam = Annotated[
    str | None,
    Query(min_length=1, max_length=120, description="Search by English or Tamil item name."),
]
ItemScopeParam = Annotated[
    ItemScope | None,
    Query(description="Filter shop item rows by catalogue/global or shop-owned scope."),
]
ItemAllocatedParam = Annotated[
    bool | None,
    Query(description="When set, filter to allocated or unallocated item rows."),
]
ItemPricedParam = Annotated[
    bool | None,
    Query(description="When set, filter to item rows with or without a current shop price."),
]
ItemPriceStatusParam = Annotated[
    PriceStatus | None,
    Query(
        description="Filter allocated active item rows by missing, stale, or current price status."
    ),
]
ItemActiveParam = Annotated[
    bool | None,
    Query(description="When set, filter to active or paused item rows."),
]
ItemCategoryIdParam = Annotated[
    UUID | None,
    Query(description="Filter selected shop items to one category ID."),
]
ItemUncategorizedParam = Annotated[
    bool | None,
    Query(description="When true, filter selected shop items without a category."),
]
ItemCursorGroupParam = Annotated[
    int | None,
    Query(ge=0, le=1, description="Pagination cursor allocation group from the previous page."),
]
ItemCursorSortOrderParam = Annotated[
    int | None,
    Query(description="Pagination cursor effective item sort order from the previous page."),
]
ItemCursorNameParam = Annotated[
    str | None,
    Query(description="Pagination cursor normalized item name from the previous page."),
]
ItemCursorIdParam = Annotated[
    UUID | None,
    Query(description="Pagination cursor item ID from the previous page."),
]
CursorCreatedAtParam = Annotated[
    datetime | None,
    Query(description="Pagination cursor timestamp from the previous page."),
]
CursorSpentAtParam = Annotated[
    datetime | None,
    Query(description="Pagination cursor expense timestamp from the previous page."),
]
CursorIdParam = Annotated[
    UUID | None,
    Query(description="Pagination cursor bill ID from the previous page."),
]
DashboardBillsLimitParam = Annotated[
    int,
    Query(
        ge=1,
        le=200,
        description="Maximum number of recent bills embedded in the bootstrap response.",
    ),
]
DBSession = Annotated[AsyncSession, Depends(get_tenant_db)]
AdminUserDep = Annotated[User, Depends(get_current_admin)]
ShopDep = Annotated[Shop, Depends(get_tenant_shop_or_404)]
ItemImageUploadOptional = Annotated[
    UploadFile | None,
    File(
        description="Optional item image file. Stored in RustFS; metadata is saved in Postgres.",
    ),
]
ItemImageUploadRequired = Annotated[
    UploadFile,
    File(
        description="Replacement image file for the item. Stored in RustFS; metadata is saved in Postgres.",
    ),
]


def _parse_custom_attributes(raw_value: str | None) -> dict[str, str | int | float | bool | None]:
    if raw_value is None or not raw_value.strip():
        return {}
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="custom_attributes must be a valid JSON object",
        ) from exc
    if not isinstance(parsed, dict):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="custom_attributes must be a valid JSON object",
        )
    allowed_types = (str, int, float, bool, type(None))
    if any(not isinstance(value, allowed_types) for value in parsed.values()):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="custom_attributes values must be strings, numbers, booleans, or null",
        )
    return parsed


def _parse_inventory_category_ids(raw_value: str | None) -> list[UUID]:
    if raw_value is None or not raw_value.strip():
        return []
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="category_ids must be a valid JSON array",
        ) from exc
    if not isinstance(parsed, list):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="category_ids must be a valid JSON array",
        )
    try:
        return [UUID(str(value)) for value in parsed]
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="category_ids must contain valid UUID values",
        ) from exc


def _parse_inventory_billing_item_ids(raw_value: str | None) -> list[UUID]:
    if raw_value is None or not raw_value.strip():
        return []
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="billing_item_ids must be a valid JSON array",
        ) from exc
    if not isinstance(parsed, list):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="billing_item_ids must be a valid JSON array",
        )
    try:
        return [UUID(str(value)) for value in parsed]
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="billing_item_ids must contain valid UUID values",
        ) from exc


def _parse_inventory_billing_mappings(
    raw_value: str | None,
) -> list[InventoryBillingItemMappingWrite]:
    if raw_value is None or not raw_value.strip():
        return []
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="billing_mappings must be a valid JSON array",
        ) from exc
    if not isinstance(parsed, list):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="billing_mappings must be a valid JSON array",
        )
    mappings: list[InventoryBillingItemMappingWrite] = []
    try:
        for row in parsed:
            if not isinstance(row, dict):
                raise TypeError("billing mapping row must be an object")
            mappings.append(
                InventoryBillingItemMappingWrite(
                    inventory_category_id=(
                        UUID(str(row["inventory_category_id"]))
                        if row.get("inventory_category_id") is not None
                        else None
                    ),
                    billing_item_id=UUID(str(row["billing_item_id"])),
                )
            )
        return mappings
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="billing_mappings must contain inventory_category_id and billing_item_id UUID values",
        ) from exc


__all__ = [
    "AdminUserDep",
    "AnalyticsPeriodParam",
    "BillsLimitParam",
    "CursorCreatedAtParam",
    "CursorIdParam",
    "CursorSpentAtParam",
    "DashboardBillsLimitParam",
    "DBSession",
    "ItemActiveParam",
    "ItemAllocatedParam",
    "ItemCategoryIdParam",
    "ItemCursorGroupParam",
    "ItemCursorIdParam",
    "ItemCursorNameParam",
    "ItemCursorSortOrderParam",
    "ItemImageUploadOptional",
    "ItemImageUploadRequired",
    "ItemPriceStatusParam",
    "ItemPricedParam",
    "ItemScopeParam",
    "ItemSearchParam",
    "ItemUncategorizedParam",
    "ItemsLimitParam",
    "PriceHistoryDateParam",
    "RangeEndDateParam",
    "RangeStartDateParam",
    "ReferenceDateParam",
    "ReportDetailLevelParam",
    "ReportLanguageParam",
    "ReportSectionsParam",
    "ShopDep",
    "ShopIdParam",
    "ShopIdsParam",
    "_parse_custom_attributes",
    "_parse_inventory_billing_item_ids",
    "_parse_inventory_billing_mappings",
    "_parse_inventory_category_ids",
]
