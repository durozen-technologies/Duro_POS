"""Admin API routes for shop management, analytics, pricing, and dashboard data.

These handlers are intentionally thin: authentication/authorization and
request-shape concerns live at the router layer, while business logic and
query optimization stay in the service layer.
"""

import json
from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_roles
from app.core.deps import get_current_admin, get_shop_or_404
from app.db.database import get_db
from app.db.storage import upload_item_image
from app.models import BaseUnit, Shop, UnitType, User, UserRole
from app.schemas.admin import (
    AdminBillPage,
    AdminDashboardBootstrap,
    AdminItemRowsPage,
    AdminReportDetailLevel,
    AdminReportSection,
    AnalyticsPeriod,
    ItemAssumptionUpdate,
    ItemCategoryCreate,
    ItemCategoryRead,
    ItemCategoryUpdate,
    ItemCreate,
    ItemMetadataUpdate,
    ItemRead,
    ItemSalesSummary,
    ItemScope,
    ItemUpdate,
    OverallReportRead,
    PaymentSplitSummary,
    PriceStatus,
    ShopCreate,
    ShopItemAllocationBulkCreate,
    ShopItemAllocationBulkRead,
    ShopItemAllocationUpdate,
    ShopItemCounts,
    ShopItemPage,
    ShopItemRead,
    ShopRead,
    ShopSalesSummary,
    ShopSelectedItemsOrderRead,
    ShopSelectedItemsOrderUpdate,
    ShopStatusUpdate,
    ShopUpdate,
)
from app.schemas.billing import BillDetailBatchRequest, BillRead
from app.schemas.expenses import (
    ExpenseEntryPage,
    ExpenseItemCounts,
    ExpenseItemCreate,
    ExpenseItemRead,
    ExpenseItemRowsPage,
    ExpenseItemUpdate,
    ShopExpenseAllocationBulkCreate,
    ShopExpenseAllocationBulkRead,
    ShopExpenseAllocationUpdate,
    ShopExpenseItemRead,
    ShopExpenseItemRowsPage,
    ShopExpenseItemsOrderRead,
    ShopExpenseItemsOrderUpdate,
)
from app.schemas.inventory import (
    InventoryBillingItemMappingWrite,
    InventoryCategoryCreate,
    InventoryCategoryRead,
    InventoryCategoryUpdate,
    InventoryItemCounts,
    InventoryItemCreate,
    InventoryItemImageRead,
    InventoryItemPurchaseRateUpdate,
    InventoryItemRead,
    InventoryItemRowsPage,
    InventoryItemStockRead,
    InventoryItemUpdate,
    InventoryMovementPage,
    InventoryPurchaseRatesConfirmRead,
    InventoryStockRowsPage,
    InventorySummaryRead,
    ShopInventoryAllocationBulkCreate,
    ShopInventoryAllocationBulkRead,
    ShopInventoryAllocationUpdate,
)
from app.schemas.pricing import (
    DailyPriceCreate,
    DailyPriceRead,
    DailyPriceUpdate,
    ItemImageRead,
    ShopBootstrapResponse,
)
from app.schemas.transfer import (
    InventoryTransferPage,
    TransferShopCreate,
    TransferShopRead,
    TransferShopUpdate,
)
from app.services.admin import (
    allocate_catalogue_item,
    allocate_catalogue_items,
    count_catalogue_items,
    count_selected_shop_items,
    count_shop_item_import_candidates,
    create_item,
    create_item_category,
    create_shop_account,
    deallocate_catalogue_item,
    delete_item,
    delete_item_category,
    delete_shop_account,
    get_bill_by_id,
    get_bills_by_ids,
    get_catalogue_item,
    get_daily_bills,
    get_dashboard_bootstrap,
    get_item_sales_summary,
    get_payment_split_summary,
    get_shop_by_id,
    get_shop_item,
    get_shop_sales_summary,
    list_catalogue_item_rows,
    list_catalogue_items,
    list_item_categories,
    list_selected_shop_item_rows,
    list_selected_shop_items,
    list_shop_item_import_candidate_rows,
    list_shop_item_import_candidates,
    list_shop_items,
    list_shops,
    set_shop_active_state,
    update_catalogue_item_allocation,
    update_item,
    update_item_assumption,
    update_item_category,
    update_item_metadata,
    update_selected_shop_items_order,
    update_shop_account,
)
from app.services.expenses import (
    allocate_shop_expense_item,
    allocate_shop_expense_items,
    count_expense_items,
    create_expense_item,
    deallocate_shop_expense_item,
    delete_expense_item,
    get_expense_item,
    list_expense_entries,
    list_expense_item_rows,
    list_shop_expense_candidate_rows,
    list_shop_expense_item_rows,
    remove_expense_item_image,
    update_expense_item,
    update_shop_expense_allocation,
    update_shop_expense_items_order,
    upload_expense_item_image,
)
from app.services.inventory import (
    allocate_shop_inventory_items,
    confirm_inventory_purchase_rates_today,
    count_inventory_items,
    create_inventory_category,
    delete_inventory_category,
    get_inventory_item,
    get_inventory_summary,
    list_inventory_categories,
    list_inventory_item_rows,
    list_inventory_items,
    list_inventory_movements,
    list_inventory_stock_rows,
    update_inventory_category,
    update_inventory_item_purchase_rate,
    update_shop_inventory_allocation,
)
from app.services.inventory import (
    create_inventory_item as create_inventory_management_item,
)
from app.services.inventory import (
    delete_inventory_item as delete_inventory_management_item,
)
from app.services.inventory import (
    remove_inventory_item_image as remove_inventory_item_image_service,
)
from app.services.inventory import (
    update_inventory_item as update_inventory_management_item,
)
from app.services.inventory import (
    upload_inventory_item_image as upload_inventory_item_image_service,
)
from app.services.pricing import (
    create_daily_prices,
    create_global_daily_prices,
    create_partial_daily_prices,
    get_global_bootstrap,
    get_shop_bootstrap,
    get_shop_price_history,
    upsert_shop_daily_price,
)
from app.services.reports import (
    build_overall_report,
    generate_admin_report_pdf,
    iter_admin_report_file,
)
from app.services.storage import delete_item_image
from app.services.transfer import (
    create_transfer_shop,
    list_inventory_transfers,
    list_transfer_shops,
    update_transfer_shop,
)

router = APIRouter(tags=["Admin"], dependencies=[Depends(require_roles(UserRole.ADMIN))])

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
DBSession = Annotated[AsyncSession, Depends(get_db)]
AdminUserDep = Annotated[User, Depends(get_current_admin)]
ShopDep = Annotated[Shop, Depends(get_shop_or_404)]
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


def _parse_inventory_billing_mappings(raw_value: str | None) -> list[InventoryBillingItemMappingWrite]:
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


# ── Shop CRUD ──────────────────────────────────────────────────────────────────


@router.post("/shops", response_model=ShopRead, status_code=201, summary="Create Shop Account")
async def create_shop(
    payload: ShopCreate,
    db: DBSession,
    current_user: AdminUserDep,
) -> ShopRead:
    """Create a new shop branch and its linked shop-account user."""
    return await create_shop_account(db, payload, current_user)


@router.get(
    "/shops", response_model=list[ShopRead], response_model_exclude_unset=True, summary="List Shops"
)
async def get_shops(db: DBSession) -> list[ShopRead]:
    """Return every shop branch visible in the admin console."""
    return await list_shops(db)


@router.get(
    "/shops/{shop_id}",
    response_model=ShopRead,
    response_model_exclude_unset=True,
    summary="Get Shop",
)
async def get_shop(shop_id: UUID, db: DBSession) -> ShopRead:
    """Fetch a single shop branch by its ID."""
    return await get_shop_by_id(db, shop_id)


@router.patch(
    "/shops/{shop_id}",
    response_model=ShopRead,
    response_model_exclude_unset=True,
    summary="Update Shop Account",
)
async def update_shop(
    shop_id: UUID,
    payload: ShopUpdate,
    db: DBSession,
) -> ShopRead:
    """Update shop metadata and its linked login credentials."""
    return await update_shop_account(db, shop_id, payload)


@router.patch(
    "/shops/{shop_id}/status",
    response_model=ShopRead,
    response_model_exclude_unset=True,
    summary="Set Shop Status",
)
async def update_shop_status(
    shop_id: UUID,
    payload: ShopStatusUpdate,
    db: DBSession,
) -> ShopRead:
    """Enable or disable a shop and its linked shop-account user."""
    return await set_shop_active_state(db, shop_id, payload.is_active)


@router.get(
    "/item-categories",
    response_model=list[ItemCategoryRead],
    response_model_exclude_unset=True,
    summary="List Item Categories",
)
async def get_item_categories(db: DBSession) -> list[ItemCategoryRead]:
    """Return global item categories for catalogue item forms and filters."""
    return await list_item_categories(db)


@router.post(
    "/item-categories",
    response_model=ItemCategoryRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Create Item Category",
)
async def create_admin_item_category(
    payload: ItemCategoryCreate,
    db: DBSession,
) -> ItemCategoryRead:
    """Create a reusable global item category."""
    return await create_item_category(db, payload)


@router.patch(
    "/item-categories/{category_id}",
    response_model=ItemCategoryRead,
    response_model_exclude_unset=True,
    summary="Update Item Category",
)
async def update_admin_item_category(
    category_id: UUID,
    payload: ItemCategoryUpdate,
    db: DBSession,
) -> ItemCategoryRead:
    """Rename a category and refresh assigned item category labels."""
    return await update_item_category(db, category_id, payload)


@router.delete(
    "/item-categories/{category_id}",
    status_code=204,
    summary="Delete Item Category",
)
async def delete_admin_item_category(category_id: UUID, db: DBSession) -> Response:
    """Delete a category and clear it from assigned catalogue items."""
    await delete_item_category(db, category_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/inventory/categories",
    response_model=list[InventoryCategoryRead],
    response_model_exclude_unset=True,
    summary="List Inventory Categories",
)
async def get_inventory_categories(db: DBSession) -> list[InventoryCategoryRead]:
    return await list_inventory_categories(db)


@router.post(
    "/inventory/categories",
    response_model=InventoryCategoryRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Create Inventory Category",
)
async def create_admin_inventory_category(
    payload: InventoryCategoryCreate,
    db: DBSession,
) -> InventoryCategoryRead:
    return await create_inventory_category(db, payload)


@router.patch(
    "/inventory/categories/{category_id}",
    response_model=InventoryCategoryRead,
    response_model_exclude_unset=True,
    summary="Update Inventory Category",
)
async def update_admin_inventory_category(
    category_id: UUID,
    payload: InventoryCategoryUpdate,
    db: DBSession,
) -> InventoryCategoryRead:
    return await update_inventory_category(db, category_id, payload)


@router.delete(
    "/inventory/categories/{category_id}",
    status_code=204,
    summary="Delete Inventory Category",
)
async def delete_admin_inventory_category(category_id: UUID, db: DBSession) -> Response:
    await delete_inventory_category(db, category_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/inventory/items",
    response_model=list[InventoryItemRead],
    response_model_exclude_unset=True,
    summary="List Inventory Items",
)
async def get_inventory_items(
    db: DBSession,
    q: ItemSearchParam = None,
    active: ItemActiveParam = None,
) -> list[InventoryItemRead]:
    return await list_inventory_items(db, q=q, active=active)


@router.get(
    "/inventory/items/rows",
    response_model=InventoryItemRowsPage,
    response_model_exclude_unset=True,
    summary="List Inventory Item Rows",
)
async def get_inventory_item_rows(
    db: DBSession,
    q: ItemSearchParam = None,
    active: ItemActiveParam = None,
    limit: ItemsLimitParam = 100,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> InventoryItemRowsPage:
    return await list_inventory_item_rows(
        db,
        q=q,
        active=active,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/inventory/items/counts",
    response_model=InventoryItemCounts,
    response_model_exclude_unset=True,
    summary="Count Inventory Items",
)
async def get_inventory_item_counts(
    db: DBSession,
    q: ItemSearchParam = None,
    active: ItemActiveParam = None,
) -> InventoryItemCounts:
    return await count_inventory_items(db, q=q, active=active)


@router.get(
    "/inventory/items/{item_id}",
    response_model=InventoryItemRead,
    response_model_exclude_unset=True,
    summary="Get Inventory Item",
)
async def get_admin_inventory_item(item_id: UUID, db: DBSession) -> InventoryItemRead:
    return await get_inventory_item(db, item_id)


@router.post(
    "/inventory/items",
    response_model=InventoryItemRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Create Inventory Item",
)
async def create_admin_inventory_management_item(
    name: Annotated[str, Form(min_length=2, max_length=120)],
    unit_type: Annotated[UnitType, Form()],
    base_unit: Annotated[BaseUnit, Form()],
    tamil_name: Annotated[str, Form(min_length=1, max_length=120)],
    db: DBSession,
    is_active: Annotated[bool, Form()] = True,
    sort_order: Annotated[int, Form()] = 0,
    category_ids: Annotated[str, Form()] = "[]",
    billing_item_ids: Annotated[str, Form()] = "[]",
    billing_mappings: Annotated[str, Form()] = "[]",
    image: ItemImageUploadOptional = None,
) -> InventoryItemRead:
    payload = InventoryItemCreate(
        name=name,
        tamil_name=tamil_name,
        unit_type=unit_type,
        base_unit=base_unit,
        is_active=is_active,
        sort_order=sort_order,
        category_ids=_parse_inventory_category_ids(category_ids),
        billing_item_ids=_parse_inventory_billing_item_ids(billing_item_ids),
        billing_mappings=_parse_inventory_billing_mappings(billing_mappings),
    )
    return await create_inventory_management_item(db, payload, image=image)


@router.post(
    "/inventory/items/metadata",
    response_model=InventoryItemRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Create Inventory Item Metadata",
)
async def create_admin_inventory_item_metadata(
    payload: InventoryItemCreate,
    db: DBSession,
) -> InventoryItemRead:
    return await create_inventory_management_item(db, payload)


@router.patch(
    "/inventory/items/{item_id}",
    response_model=InventoryItemRead,
    response_model_exclude_unset=True,
    summary="Update Inventory Item",
)
async def update_admin_inventory_management_item(
    item_id: UUID,
    name: Annotated[str, Form(min_length=2, max_length=120)],
    unit_type: Annotated[UnitType, Form()],
    base_unit: Annotated[BaseUnit, Form()],
    tamil_name: Annotated[str, Form(min_length=1, max_length=120)],
    db: DBSession,
    is_active: Annotated[bool, Form()] = True,
    sort_order: Annotated[int, Form()] = 0,
    category_ids: Annotated[str, Form()] = "[]",
    billing_item_ids: Annotated[str, Form()] = "[]",
    billing_mappings: Annotated[str, Form()] = "[]",
    remove_image: Annotated[bool, Form()] = False,
    image: ItemImageUploadOptional = None,
) -> InventoryItemRead:
    payload = InventoryItemUpdate(
        name=name,
        tamil_name=tamil_name,
        unit_type=unit_type,
        base_unit=base_unit,
        is_active=is_active,
        sort_order=sort_order,
        category_ids=_parse_inventory_category_ids(category_ids),
        billing_item_ids=_parse_inventory_billing_item_ids(billing_item_ids),
        billing_mappings=_parse_inventory_billing_mappings(billing_mappings),
    )
    return await update_inventory_management_item(
        db,
        item_id,
        payload,
        image=image,
        remove_image=remove_image,
    )


@router.patch(
    "/inventory/items/{item_id}/metadata",
    response_model=InventoryItemRead,
    response_model_exclude_unset=True,
    summary="Update Inventory Item Metadata",
)
async def patch_admin_inventory_item_metadata(
    item_id: UUID,
    payload: InventoryItemUpdate,
    db: DBSession,
) -> InventoryItemRead:
    return await update_inventory_management_item(db, item_id, payload)


@router.patch(
    "/inventory/items/{item_id}/purchase-rate",
    response_model=InventoryItemRead,
    response_model_exclude_unset=True,
    summary="Update Inventory Item Purchase Rate",
)
async def patch_admin_inventory_item_purchase_rate(
    item_id: UUID,
    payload: InventoryItemPurchaseRateUpdate,
    db: DBSession,
) -> InventoryItemRead:
    return await update_inventory_item_purchase_rate(db, item_id, payload)


@router.post(
    "/inventory/items/purchase-rates/confirm-today",
    response_model=InventoryPurchaseRatesConfirmRead,
    summary="Confirm Today's Inventory Purchase Rates",
)
async def confirm_admin_inventory_purchase_rates_today(
    db: DBSession,
) -> InventoryPurchaseRatesConfirmRead:
    updated_count = await confirm_inventory_purchase_rates_today(db)
    return InventoryPurchaseRatesConfirmRead(updated_count=updated_count)


@router.put(
    "/inventory/items/{item_id}/image",
    response_model=InventoryItemImageRead,
    response_model_exclude_unset=True,
    summary="Replace Inventory Item Image",
)
async def upload_admin_inventory_item_image(
    item_id: UUID,
    image: ItemImageUploadRequired,
    db: DBSession,
) -> InventoryItemImageRead:
    return await upload_inventory_item_image_service(db, item_id, image)


@router.delete(
    "/inventory/items/{item_id}/image",
    response_model=InventoryItemImageRead,
    response_model_exclude_unset=True,
    summary="Remove Inventory Item Image",
)
async def delete_admin_inventory_item_image(
    item_id: UUID,
    db: DBSession,
) -> InventoryItemImageRead:
    return await remove_inventory_item_image_service(db, item_id)


@router.delete(
    "/inventory/items/{item_id}",
    status_code=204,
    summary="Delete Inventory Item",
)
async def delete_admin_inventory_management_item(item_id: UUID, db: DBSession) -> Response:
    await delete_inventory_management_item(db, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/expenses/items",
    response_model=ExpenseItemRowsPage,
    response_model_exclude_unset=True,
    summary="List Expense Items",
)
async def get_expense_items(
    db: DBSession,
    q: ItemSearchParam = None,
    active: ItemActiveParam = None,
    limit: ItemsLimitParam = 50,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> ExpenseItemRowsPage:
    return await list_expense_item_rows(
        db,
        q=q,
        active=active,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/expenses/items/counts",
    response_model=ExpenseItemCounts,
    response_model_exclude_unset=True,
    summary="Count Expense Items",
)
async def get_expense_item_counts(
    db: DBSession,
    q: ItemSearchParam = None,
) -> ExpenseItemCounts:
    return await count_expense_items(db, q=q)


@router.post(
    "/expenses/items",
    response_model=ExpenseItemRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Create Expense Item",
)
async def create_admin_expense_item(
    payload: ExpenseItemCreate,
    db: DBSession,
) -> ExpenseItemRead:
    return await create_expense_item(db, payload)


@router.get(
    "/expenses/items/{expense_item_id}",
    response_model=ExpenseItemRead,
    response_model_exclude_unset=True,
    summary="Get Expense Item",
)
async def get_admin_expense_item(expense_item_id: UUID, db: DBSession) -> ExpenseItemRead:
    return await get_expense_item(db, expense_item_id)


@router.patch(
    "/expenses/items/{expense_item_id}",
    response_model=ExpenseItemRead,
    response_model_exclude_unset=True,
    summary="Update Expense Item",
)
async def update_admin_expense_item(
    expense_item_id: UUID,
    payload: ExpenseItemUpdate,
    db: DBSession,
) -> ExpenseItemRead:
    return await update_expense_item(db, expense_item_id, payload)


@router.delete(
    "/expenses/items/{expense_item_id}",
    status_code=204,
    summary="Delete Expense Item",
)
async def delete_admin_expense_item(expense_item_id: UUID, db: DBSession) -> Response:
    await delete_expense_item(db, expense_item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/expenses/items/{expense_item_id}/image",
    response_model=ExpenseItemRead,
    response_model_exclude_unset=True,
    summary="Upload Expense Item Image",
)
async def upload_admin_expense_item_image(
    expense_item_id: UUID,
    db: DBSession,
    image: ItemImageUploadRequired,
) -> ExpenseItemRead:
    return await upload_expense_item_image(db, expense_item_id, image)


@router.delete(
    "/expenses/items/{expense_item_id}/image",
    response_model=ExpenseItemRead,
    response_model_exclude_unset=True,
    summary="Delete Expense Item Image",
)
async def delete_admin_expense_item_image(expense_item_id: UUID, db: DBSession) -> ExpenseItemRead:
    return await remove_expense_item_image(db, expense_item_id)


@router.get(
    "/shops/{shop_id}/expense-items",
    response_model=ShopExpenseItemRowsPage,
    response_model_exclude_unset=True,
    summary="List Branch Expense Items",
)
async def get_shop_expense_items(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    active: ItemActiveParam = None,
    limit: ItemsLimitParam = 50,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> ShopExpenseItemRowsPage:
    return await list_shop_expense_item_rows(
        db,
        shop,
        q=q,
        active=active,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/shops/{shop_id}/expense-items/counts",
    response_model=ExpenseItemCounts,
    response_model_exclude_unset=True,
    summary="Count Branch Expense Items",
)
async def get_shop_expense_item_counts(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
) -> ExpenseItemCounts:
    return await count_expense_items(db, shop_id=shop.id, q=q)


@router.get(
    "/shops/{shop_id}/expense-item-candidates",
    response_model=ExpenseItemRowsPage,
    response_model_exclude_unset=True,
    summary="List Branch Expense Item Candidates",
)
async def get_shop_expense_item_candidates(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    limit: ItemsLimitParam = 50,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> ExpenseItemRowsPage:
    return await list_shop_expense_candidate_rows(
        db,
        shop,
        q=q,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.post(
    "/shops/{shop_id}/expense-items/allocations",
    response_model=ShopExpenseAllocationBulkRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Allocate Branch Expense Items",
)
async def allocate_shop_expenses(
    payload: ShopExpenseAllocationBulkCreate,
    shop: ShopDep,
    db: DBSession,
) -> ShopExpenseAllocationBulkRead:
    return await allocate_shop_expense_items(db, shop, payload.expense_item_ids)


@router.post(
    "/shops/{shop_id}/expense-items/{expense_item_id}/allocation",
    response_model=ShopExpenseItemRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Allocate Branch Expense Item",
)
async def allocate_shop_expense(
    expense_item_id: UUID,
    shop: ShopDep,
    db: DBSession,
) -> ShopExpenseItemRead:
    return await allocate_shop_expense_item(db, shop, expense_item_id)


@router.patch(
    "/shops/{shop_id}/expense-items/{expense_item_id}/allocation",
    response_model=ShopExpenseItemRead,
    response_model_exclude_unset=True,
    summary="Update Branch Expense Allocation",
)
async def update_shop_expense(
    expense_item_id: UUID,
    payload: ShopExpenseAllocationUpdate,
    shop: ShopDep,
    db: DBSession,
) -> ShopExpenseItemRead:
    return await update_shop_expense_allocation(db, shop, expense_item_id, payload)


@router.delete(
    "/shops/{shop_id}/expense-items/{expense_item_id}/allocation",
    response_model=ShopExpenseItemRead,
    response_model_exclude_unset=True,
    summary="Remove Branch Expense Allocation",
)
async def deallocate_shop_expense(
    expense_item_id: UUID,
    shop: ShopDep,
    db: DBSession,
) -> ShopExpenseItemRead:
    return await deallocate_shop_expense_item(db, shop, expense_item_id)


@router.put(
    "/shops/{shop_id}/expense-items/order",
    response_model=ShopExpenseItemsOrderRead,
    response_model_exclude_unset=True,
    summary="Update Branch Expense Item Order",
)
async def update_shop_expense_order(
    payload: ShopExpenseItemsOrderUpdate,
    shop: ShopDep,
    db: DBSession,
) -> ShopExpenseItemsOrderRead:
    return await update_shop_expense_items_order(db, shop, payload.expense_item_ids)


@router.get(
    "/expenses/history",
    response_model=ExpenseEntryPage,
    response_model_exclude_unset=True,
    summary="List Expense History",
)
async def get_expense_history(
    db: DBSession,
    shop_id: ShopIdParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    limit: ItemsLimitParam = 50,
    cursor_spent_at: CursorSpentAtParam = None,
    cursor_id: CursorIdParam = None,
) -> ExpenseEntryPage:
    return await list_expense_entries(
        db,
        shop_id=shop_id,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        limit=limit,
        cursor_spent_at=cursor_spent_at,
        cursor_id=cursor_id,
    )


@router.get(
    "/shops/{shop_id}/inventory-allocations/rows",
    response_model=InventoryStockRowsPage,
    response_model_exclude_unset=True,
    summary="List Shop Inventory Allocation Rows",
)
async def get_shop_inventory_allocation_rows(
    shop: ShopDep,
    db: DBSession,
    q: str | None = Query(None, min_length=1, max_length=120),
    active: bool | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    cursor_sort_order: int | None = Query(None),
    cursor_name: str | None = Query(None, max_length=120),
    cursor_id: UUID | None = Query(None),
) -> InventoryStockRowsPage:
    return await list_inventory_stock_rows(
        db,
        shop,
        q=q,
        active=active,
        include_unallocated=True,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/shops/{shop_id}/inventory-allocations",
    response_model=InventorySummaryRead,
    response_model_exclude_unset=True,
    summary="List Shop Inventory Allocations",
)
async def get_shop_inventory_allocations(shop: ShopDep, db: DBSession) -> InventorySummaryRead:
    return await get_inventory_summary(db, shop, include_unallocated=True)


@router.post(
    "/shops/{shop_id}/inventory-allocations",
    response_model=ShopInventoryAllocationBulkRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Allocate Inventory Items",
)
async def allocate_shop_inventory(
    payload: ShopInventoryAllocationBulkCreate,
    shop: ShopDep,
    db: DBSession,
) -> ShopInventoryAllocationBulkRead:
    return await allocate_shop_inventory_items(db, shop, payload.item_ids)


@router.patch(
    "/shops/{shop_id}/inventory-allocations",
    response_model=InventoryItemStockRead | InventorySummaryRead,
    response_model_exclude_unset=True,
    summary="Update Shop Inventory Allocation",
)
async def update_shop_inventory(
    payload: ShopInventoryAllocationUpdate,
    shop: ShopDep,
    db: DBSession,
    include_summary: bool = Query(False, description="Include the full inventory summary in the response."),
) -> InventoryItemStockRead | InventorySummaryRead:
    stock_item = await update_shop_inventory_allocation(
        db,
        shop,
        payload.item_id,
        is_active=payload.is_active,
        sort_order=payload.sort_order,
    )
    if include_summary:
        return await get_inventory_summary(db, shop, include_unallocated=True)
    return stock_item


@router.get(
    "/inventory/summary",
    response_model=InventorySummaryRead,
    response_model_exclude_unset=True,
    summary="Get Inventory Summary",
)
async def get_admin_inventory_summary(
    db: DBSession,
    shop: ShopDep,
) -> InventorySummaryRead:
    return await get_inventory_summary(db, shop, include_unallocated=False)


@router.get(
    "/inventory/movements",
    response_model=InventoryMovementPage,
    response_model_exclude_unset=True,
    summary="List Inventory Movements",
)
async def get_admin_inventory_movements(
    db: DBSession,
    shop_id: ShopIdParam = None,
    item_id: ItemCursorIdParam = None,
    category_id: ItemCategoryIdParam = None,
    reference_date: ReferenceDateParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    limit: ItemsLimitParam = 100,
) -> InventoryMovementPage:
    return await list_inventory_movements(
        db,
        shop_id=shop_id,
        item_id=item_id,
        category_id=category_id,
        reference_date=reference_date,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        limit=limit,
    )


@router.post(
    "/shops/{shop_id}/items",
    response_model=ItemRead,
    status_code=201,
    summary="Create Shop Item",
    description=(
        "Create an item owned by this shop. Submit multipart form-data with item fields and "
        "an optional square 1:1 image. The item appears in this shop's price setup and billing."
    ),
)
async def create_shop_inventory_item(
    name: Annotated[
        str, Form(min_length=2, max_length=120, description="Display name of the item.")
    ],
    unit_type: Annotated[
        UnitType,
        Form(description="High-level quantity mode: `weight` or `count`."),
    ],
    base_unit: Annotated[
        BaseUnit,
        Form(description="Base billing unit used for prices and quantities: `kg` or `unit`."),
    ],
    tamil_name: Annotated[
        str,
        Form(min_length=1, max_length=120, description="Tamil display name of the item."),
    ],
    shop: ShopDep,
    db: DBSession,
    is_active: Annotated[
        bool,
        Form(
            description="Whether the item should be available for pricing and billing immediately."
        ),
    ] = True,
    custom_attributes: Annotated[
        str,
        Form(description="JSON object with admin-defined item attributes."),
    ] = "{}",
    sort_order: Annotated[int, Form(description="Display sort order for item lists.")] = 0,
    category: Annotated[
        str | None, Form(max_length=80, description="Optional display category.")
    ] = None,
    category_id: Annotated[
        UUID | None, Form(description="Optional reusable item category ID.")
    ] = None,
    image: ItemImageUploadOptional = None,
) -> ItemRead:
    payload = ItemCreate(
        name=name,
        tamil_name=tamil_name,
        unit_type=unit_type,
        base_unit=base_unit,
        is_active=is_active,
        sort_order=sort_order,
        category_id=category_id,
        category=category,
        custom_attributes=_parse_custom_attributes(custom_attributes),
    )
    return await create_item(db, payload, image=image, shop_id=shop.id)


@router.get(
    "/shops/{shop_id}/items",
    response_model=ShopItemPage,
    response_model_exclude_unset=True,
    summary="List Shop Items",
)
async def get_shop_items(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    scope: ItemScopeParam = None,
    allocated: ItemAllocatedParam = None,
    priced: ItemPricedParam = None,
    price_status: ItemPriceStatusParam = None,
    active: ItemActiveParam = None,
    limit: ItemsLimitParam = 500,
    cursor_group: ItemCursorGroupParam = None,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> ShopItemPage:
    """Return catalogue items plus this shop's own items with allocation state and prices."""
    return await list_shop_items(
        db,
        shop,
        q=q,
        scope=scope,
        allocated=allocated,
        priced=priced,
        price_status=price_status,
        active=active,
        limit=limit,
        cursor_group=cursor_group,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/shops/{shop_id}/selected-items",
    response_model=ShopItemPage,
    response_model_exclude_unset=True,
    summary="List Selected Shop Items",
)
async def get_selected_shop_items(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    limit: ItemsLimitParam = 100,
    category_id: ItemCategoryIdParam = None,
    uncategorized: ItemUncategorizedParam = None,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> ShopItemPage:
    """Return compact selected item rows for the shop item management page."""
    return await list_selected_shop_items(
        db,
        shop,
        q=q,
        limit=limit,
        category_id=category_id,
        uncategorized=uncategorized,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/shops/{shop_id}/selected-items/rows",
    response_model=AdminItemRowsPage,
    response_model_exclude_unset=True,
    summary="List Selected Shop Item Rows",
)
async def get_selected_shop_item_rows(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    limit: ItemsLimitParam = 100,
    category_id: ItemCategoryIdParam = None,
    uncategorized: ItemUncategorizedParam = None,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> AdminItemRowsPage:
    """Return row-first selected shop item data without count-heavy joins."""
    return await list_selected_shop_item_rows(
        db,
        shop,
        q=q,
        limit=limit,
        category_id=category_id,
        uncategorized=uncategorized,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/shops/{shop_id}/selected-items/counts",
    response_model=ShopItemCounts,
    response_model_exclude_unset=True,
    summary="Count Selected Shop Items",
)
async def get_selected_shop_item_counts(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    category_id: ItemCategoryIdParam = None,
    uncategorized: ItemUncategorizedParam = None,
) -> ShopItemCounts:
    """Return exact selected shop item counts for background UI badges."""
    return await count_selected_shop_items(
        db,
        shop,
        q=q,
        category_id=category_id,
        uncategorized=uncategorized,
    )


@router.put(
    "/shops/{shop_id}/selected-items/order",
    response_model=ShopSelectedItemsOrderRead,
    response_model_exclude_unset=True,
    summary="Update Selected Shop Item Order",
)
async def update_selected_shop_items_display_order(
    payload: ShopSelectedItemsOrderUpdate,
    shop: ShopDep,
    db: DBSession,
) -> ShopSelectedItemsOrderRead:
    """Persist the full per-shop selected item order used by billing."""
    return await update_selected_shop_items_order(db, shop, payload.item_ids)


@router.get(
    "/shops/{shop_id}/item-import-candidates",
    response_model=ShopItemPage,
    response_model_exclude_unset=True,
    summary="List Shop Item Import Candidates",
)
async def get_shop_item_import_candidates(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    limit: ItemsLimitParam = 100,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> ShopItemPage:
    """Return compact active catalogue items that are not yet selected for the shop."""
    return await list_shop_item_import_candidates(
        db,
        shop,
        q=q,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/shops/{shop_id}/item-import-candidates/rows",
    response_model=AdminItemRowsPage,
    response_model_exclude_unset=True,
    summary="List Shop Item Import Candidate Rows",
)
async def get_shop_item_import_candidate_rows(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    limit: ItemsLimitParam = 100,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> AdminItemRowsPage:
    """Return row-first import candidates without exact count work."""
    return await list_shop_item_import_candidate_rows(
        db,
        shop,
        q=q,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/shops/{shop_id}/item-import-candidates/counts",
    response_model=ShopItemCounts,
    response_model_exclude_unset=True,
    summary="Count Shop Item Import Candidates",
)
async def get_shop_item_import_candidate_counts(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
) -> ShopItemCounts:
    """Return exact import candidate counts for background UI badges."""
    return await count_shop_item_import_candidates(db, shop, q=q)


@router.get(
    "/shops/{shop_id}/items/{item_id}",
    response_model=ShopItemRead,
    response_model_exclude_unset=True,
    summary="Get Shop Item Detail",
)
async def get_shop_item_detail(
    item_id: UUID,
    shop: ShopDep,
    db: DBSession,
) -> ShopItemRead:
    """Return one effective shop item row for route-safe editor loading."""
    return await get_shop_item(db, shop, item_id)


@router.post(
    "/shops/{shop_id}/item-allocations/bulk",
    response_model=ShopItemAllocationBulkRead,
    response_model_exclude_unset=True,
    summary="Allocate Catalogue Items",
)
async def allocate_shop_catalogue_items(
    payload: ShopItemAllocationBulkCreate,
    shop: ShopDep,
    db: DBSession,
) -> ShopItemAllocationBulkRead:
    return await allocate_catalogue_items(db, shop, payload.item_ids)


@router.post(
    "/shops/{shop_id}/item-allocations/{item_id}",
    response_model=ShopItemRead,
    response_model_exclude_unset=True,
    summary="Allocate Catalogue Item",
)
async def allocate_shop_catalogue_item(
    item_id: UUID,
    shop: ShopDep,
    db: DBSession,
) -> ShopItemRead:
    return await allocate_catalogue_item(db, shop, item_id)


@router.patch(
    "/shops/{shop_id}/item-allocations/{item_id}",
    response_model=ShopItemRead,
    response_model_exclude_unset=True,
    summary="Update Catalogue Item Allocation",
)
async def update_shop_catalogue_item_allocation(
    item_id: UUID,
    payload: ShopItemAllocationUpdate,
    shop: ShopDep,
    db: DBSession,
) -> ShopItemRead:
    return await update_catalogue_item_allocation(db, shop, item_id, payload)


@router.delete(
    "/shops/{shop_id}/item-allocations/{item_id}",
    response_model=ShopItemRead,
    response_model_exclude_unset=True,
    summary="Deallocate Catalogue Item",
)
async def deallocate_shop_catalogue_item(
    item_id: UUID,
    shop: ShopDep,
    db: DBSession,
) -> ShopItemRead:
    return await deallocate_catalogue_item(db, shop, item_id)


@router.patch(
    "/shops/{shop_id}/items/{item_id}",
    response_model=ItemRead,
    response_model_exclude_unset=True,
    summary="Update Shop Item",
)
async def update_shop_inventory_item(
    item_id: UUID,
    name: Annotated[
        str, Form(min_length=2, max_length=120, description="Updated display name of the item.")
    ],
    unit_type: Annotated[
        UnitType,
        Form(description="Updated quantity mode: `weight` or `count`."),
    ],
    base_unit: Annotated[
        BaseUnit,
        Form(description="Updated billing unit: `kg` or `unit`."),
    ],
    tamil_name: Annotated[
        str,
        Form(min_length=1, max_length=120, description="Updated Tamil display name of the item."),
    ],
    shop: ShopDep,
    db: DBSession,
    is_active: Annotated[
        bool,
        Form(description="Whether the item remains available for pricing and billing."),
    ] = True,
    custom_attributes: Annotated[
        str,
        Form(description="JSON object with admin-defined item attributes."),
    ] = "{}",
    sort_order: Annotated[int, Form(description="Display sort order for item lists.")] = 0,
    category: Annotated[
        str | None, Form(max_length=80, description="Optional display category.")
    ] = None,
    category_id: Annotated[
        UUID | None, Form(description="Optional reusable item category ID.")
    ] = None,
    remove_image: Annotated[
        bool,
        Form(description="Remove the stored image when no replacement image is uploaded."),
    ] = False,
    image: ItemImageUploadOptional = None,
) -> ItemRead:
    payload = ItemUpdate(
        name=name,
        tamil_name=tamil_name,
        unit_type=unit_type,
        base_unit=base_unit,
        is_active=is_active,
        sort_order=sort_order,
        category_id=category_id,
        category=category,
        custom_attributes=_parse_custom_attributes(custom_attributes),
    )
    return await update_item(
        db,
        item_id,
        payload,
        image=image,
        shop_id=shop.id,
        remove_image=remove_image,
    )


@router.delete(
    "/shops/{shop_id}/items/{item_id}",
    status_code=204,
    summary="Delete Shop Item",
)
async def delete_shop_inventory_item(
    item_id: UUID,
    shop: ShopDep,
    db: DBSession,
) -> Response:
    await delete_item(db, item_id, shop_id=shop.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/items/rows",
    response_model=AdminItemRowsPage,
    response_model_exclude_unset=True,
    summary="List Catalogue Item Rows",
)
async def get_catalogue_item_rows(
    db: DBSession,
    q: ItemSearchParam = None,
    active: ItemActiveParam = None,
    limit: ItemsLimitParam = 100,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> AdminItemRowsPage:
    """Return row-first global catalogue item data without count-heavy joins."""
    return await list_catalogue_item_rows(
        db,
        q=q,
        active=active,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/items/counts",
    response_model=ShopItemCounts,
    response_model_exclude_unset=True,
    summary="Count Catalogue Items",
)
async def get_catalogue_item_counts(
    db: DBSession,
    q: ItemSearchParam = None,
    active: ItemActiveParam = None,
) -> ShopItemCounts:
    """Return exact catalogue counts for background UI badges."""
    return await count_catalogue_items(db, q=q, active=active)


@router.get(
    "/items",
    response_model=ShopItemPage,
    response_model_exclude_unset=True,
    summary="List Catalogue Items",
)
async def get_catalogue_items(
    db: DBSession,
    q: ItemSearchParam = None,
    allocated: ItemAllocatedParam = None,
    active: ItemActiveParam = None,
    limit: ItemsLimitParam = 500,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> ShopItemPage:
    """Return global catalogue items with usage counts and pagination."""
    return await list_catalogue_items(
        db,
        q=q,
        allocated=allocated,
        active=active,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.post(
    "/items",
    response_model=ItemRead,
    status_code=201,
    summary="Create Item",
    description=(
        "Create a new inventory item. Submit multipart form-data with the item fields and an optional "
        "`image` file. In production, image bytes are stored in RustFS while metadata and the object "
        "key are stored on the item row in Postgres."
    ),
)
async def create_inventory_item(
    name: Annotated[
        str, Form(min_length=2, max_length=120, description="Display name of the item.")
    ],
    unit_type: Annotated[
        UnitType,
        Form(description="High-level quantity mode: `weight` or `count`."),
    ],
    base_unit: Annotated[
        BaseUnit,
        Form(description="Base billing unit used for prices and quantities: `kg` or `unit`."),
    ],
    tamil_name: Annotated[
        str,
        Form(min_length=1, max_length=120, description="Tamil display name of the item."),
    ],
    db: DBSession,
    is_active: Annotated[
        bool,
        Form(
            description="Whether the item should be available for pricing and billing immediately."
        ),
    ] = True,
    custom_attributes: Annotated[
        str,
        Form(description="JSON object with admin-defined item attributes."),
    ] = "{}",
    sort_order: Annotated[int, Form(description="Display sort order for item lists.")] = 0,
    category: Annotated[
        str | None, Form(max_length=80, description="Optional display category.")
    ] = None,
    category_id: Annotated[
        UUID | None, Form(description="Optional reusable item category ID.")
    ] = None,
    image: ItemImageUploadOptional = None,
) -> ItemRead:
    """Create a new inventory item for pricing and billing, with an optional image upload."""
    payload = ItemCreate(
        name=name,
        tamil_name=tamil_name,
        unit_type=unit_type,
        base_unit=base_unit,
        is_active=is_active,
        sort_order=sort_order,
        category_id=category_id,
        category=category,
        custom_attributes=_parse_custom_attributes(custom_attributes),
    )
    return await create_item(db, payload, image=image)


@router.get(
    "/items/{item_id}",
    response_model=ShopItemRead,
    response_model_exclude_unset=True,
    summary="Get Catalogue Item Detail",
)
async def get_catalogue_item_detail(
    item_id: UUID,
    db: DBSession,
) -> ShopItemRead:
    """Return a catalogue item with usage and delete eligibility for item routes."""
    return await get_catalogue_item(db, item_id)


@router.patch(
    "/items/{item_id}",
    response_model=ItemRead,
    response_model_exclude_unset=True,
    summary="Update Item (Preferred)",
    description=(
        "Preferred endpoint for item edits. Update item metadata and optionally replace the image "
        "in the same multipart request. Use this endpoint for most admin item edit flows."
    ),
)
async def update_inventory_item(
    item_id: UUID,
    name: Annotated[
        str, Form(min_length=2, max_length=120, description="Updated display name of the item.")
    ],
    unit_type: Annotated[
        UnitType,
        Form(description="Updated quantity mode: `weight` or `count`."),
    ],
    base_unit: Annotated[
        BaseUnit,
        Form(description="Updated billing unit: `kg` or `unit`."),
    ],
    tamil_name: Annotated[
        str,
        Form(min_length=1, max_length=120, description="Updated Tamil display name of the item."),
    ],
    db: DBSession,
    is_active: Annotated[
        bool,
        Form(description="Whether the item remains available for pricing and billing."),
    ],
    custom_attributes: Annotated[
        str,
        Form(description="JSON object with admin-defined item attributes."),
    ] = "{}",
    sort_order: Annotated[int, Form(description="Display sort order for item lists.")] = 0,
    category: Annotated[
        str | None, Form(max_length=80, description="Optional display category.")
    ] = None,
    category_id: Annotated[
        UUID | None, Form(description="Optional reusable item category ID.")
    ] = None,
    remove_image: Annotated[
        bool,
        Form(description="Remove the stored image when no replacement image is uploaded."),
    ] = False,
    image: ItemImageUploadOptional = None,
) -> ItemRead:
    """Update item metadata, active state, and optionally replace its image."""
    payload = ItemUpdate(
        name=name,
        tamil_name=tamil_name,
        unit_type=unit_type,
        base_unit=base_unit,
        is_active=is_active,
        sort_order=sort_order,
        category_id=category_id,
        category=category,
        custom_attributes=_parse_custom_attributes(custom_attributes),
    )
    return await update_item(db, item_id, payload, image=image, remove_image=remove_image)


@router.patch(
    "/items/{item_id}/metadata",
    response_model=ItemRead,
    response_model_exclude_unset=True,
    summary="Patch Catalogue Item Metadata",
)
async def patch_inventory_item_metadata(
    item_id: UUID,
    payload: ItemMetadataUpdate,
    db: DBSession,
) -> ItemRead:
    """Partially update item metadata without requiring multipart form-data."""
    return await update_item_metadata(db, item_id, payload)


@router.patch(
    "/items/{item_id}/assumption",
    response_model=ItemRead,
    response_model_exclude_unset=True,
    summary="Patch Catalogue Item Assumption",
)
async def patch_inventory_item_assumption(
    item_id: UUID,
    payload: ItemAssumptionUpdate,
    db: DBSession,
) -> ItemRead:
    """Configure or clear the inventory deduction assumption for a catalogue item."""
    return await update_item_assumption(db, item_id, payload)


@router.patch(
    "/shops/{shop_id}/items/{item_id}/metadata",
    response_model=ItemRead,
    response_model_exclude_unset=True,
    summary="Patch Shop Item Metadata",
)
async def patch_shop_inventory_item_metadata(
    item_id: UUID,
    payload: ItemMetadataUpdate,
    shop: ShopDep,
    db: DBSession,
) -> ItemRead:
    """Partially update shop-owned item metadata without requiring multipart form-data."""
    return await update_item_metadata(db, item_id, payload, shop_id=shop.id)


@router.put(
    "/items/{item_id}/image",
    response_model=ItemImageRead,
    response_model_exclude_unset=True,
    summary="Replace Item Image (Convenience)",
    deprecated=True,
    description=(
        "Deprecated convenience endpoint for image-only updates. Prefer `PATCH /items/{item_id}` "
        "when the client can submit item fields and image together. Keep using this route only "
        "for clients that edit the image separately from the rest of the item metadata."
    ),
)
async def upload_inventory_item_image(
    item_id: UUID,
    image: ItemImageUploadRequired,
    db: DBSession,
) -> ItemImageRead:
    """Upload or replace an item's image in RustFS and persist metadata in Postgres."""
    return await upload_item_image(db, item_id, image)


@router.delete(
    "/items/{item_id}/image",
    response_model=ItemImageRead,
    response_model_exclude_unset=True,
    summary="Remove Item Image",
)
async def delete_inventory_item_image(
    item_id: UUID,
    db: DBSession,
) -> ItemImageRead:
    """Remove an item's RustFS image reference and delete the object when possible."""
    return await delete_item_image(db, item_id)


@router.delete(
    "/items/{item_id}",
    status_code=204,
    summary="Delete Item",
    description=(
        "Delete an item only if it has no billing history and no saved price history. "
        "If an image exists, its RustFS object is also removed after the database delete succeeds."
    ),
)
async def delete_inventory_item(
    item_id: UUID,
    db: DBSession,
) -> Response:
    """Delete an item only when it has no billing or price history."""
    await delete_item(db, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/shops/{shop_id}", status_code=204, summary="Delete Shop Account")
async def delete_shop(
    shop_id: UUID,
    db: DBSession,
) -> Response:
    """Delete a shop only when it has no billing or price history."""
    await delete_shop_account(db, shop_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Analytics ─────────────────────────────────────────────────────────────────


@router.get(
    "/sales-summary",
    response_model=list[ShopSalesSummary],
    response_model_exclude_unset=True,
    summary="Get Sales Summary",
)
async def sales_summary(
    period: AnalyticsPeriodParam = "date",
    reference_date: ReferenceDateParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    shop_id: ShopIdParam = None,
    db: DBSession = None,
) -> list[ShopSalesSummary]:
    """Total revenue grouped by shop for the requested time window.

    Available as a standalone reporting endpoint. The admin dashboard
    bootstrap already includes this data via ``GET /dashboard/bootstrap``.
    """
    return await get_shop_sales_summary(
        db, period, reference_date, shop_id, range_start_date, range_end_date
    )


@router.get(
    "/payment-summary",
    response_model=list[PaymentSplitSummary],
    response_model_exclude_unset=True,
    summary="Get Payment Split Summary",
)
async def payment_summary(
    period: AnalyticsPeriodParam = "date",
    reference_date: ReferenceDateParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    shop_id: ShopIdParam = None,
    db: DBSession = None,
) -> list[PaymentSplitSummary]:
    """Cash/UPI payment split grouped by shop for the requested time window.

    Available as a standalone reporting endpoint. The admin dashboard
    bootstrap already includes this data via ``GET /dashboard/bootstrap``.
    """
    return await get_payment_split_summary(
        db, period, reference_date, shop_id, range_start_date, range_end_date
    )


@router.get(
    "/item-sales",
    response_model=list[ItemSalesSummary],
    response_model_exclude_unset=True,
    summary="Get Item Sales Summary",
)
async def item_sales(
    period: AnalyticsPeriodParam = "date",
    reference_date: ReferenceDateParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    shop_id: ShopIdParam = None,
    limit: ItemsLimitParam = 100,
    db: DBSession = None,
) -> list[ItemSalesSummary]:
    """Quantity sold and revenue grouped by item for the requested time window.

    Only items that appear in at least one bill within the window are returned.
    Available as a standalone reporting endpoint. The admin dashboard
    bootstrap already includes this data via ``GET /dashboard/bootstrap``.
    """
    return await get_item_sales_summary(
        db, period, reference_date, shop_id, limit, range_start_date, range_end_date
    )


@router.get("/reports/pdf", summary="Generate Admin PDF Report")
async def admin_report_pdf(
    sections: ReportSectionsParam,
    detail_level: ReportDetailLevelParam = "summary",
    period: AnalyticsPeriodParam = "date",
    reference_date: ReferenceDateParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    shop_ids: ShopIdsParam = None,
    language: ReportLanguageParam = "en",
    db: DBSession = None,
) -> StreamingResponse:
    """Generate a merged PDF report server-side for the selected admin sections."""
    report = await generate_admin_report_pdf(
        db,
        sections=sections,
        detail_level=detail_level,
        period=period,
        reference_date=reference_date,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        shop_ids=shop_ids,
        language=language,
    )
    return StreamingResponse(
        iter_admin_report_file(report.file),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{report.filename}"'},
    )


@router.get("/reports/overall", response_model=OverallReportRead, summary="Preview Overall Report")
async def admin_overall_report(
    detail_level: ReportDetailLevelParam = "summary",
    period: AnalyticsPeriodParam = "date",
    reference_date: ReferenceDateParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    shop_ids: ShopIdsParam = None,
    db: DBSession = None,
) -> OverallReportRead:
    """Return the calculated Overall Report statement data for app preview."""
    return await build_overall_report(
        db,
        detail_level=detail_level,
        period=period,
        reference_date=reference_date,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        shop_ids=shop_ids,
    )


# ── Bills ─────────────────────────────────────────────────────────────────────


@router.get(
    "/bills", response_model=AdminBillPage, response_model_exclude_unset=True, summary="List Bills"
)
async def bills(
    period: AnalyticsPeriodParam = "date",
    reference_date: ReferenceDateParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    shop_id: ShopIdParam = None,
    limit: BillsLimitParam = 100,
    cursor_created_at: CursorCreatedAtParam = None,
    cursor_id: CursorIdParam = None,
    db: DBSession = None,
) -> AdminBillPage:
    """Cursor-paginated bill feed for the requested time window.

    Pass ``cursor_created_at`` + ``cursor_id`` from a previous response to
    fetch the next page.  Both cursor fields must be supplied together or
    both omitted — supplying only one returns a 422.
    """
    return await get_daily_bills(
        db=db,
        period=period,
        reference_date=reference_date,
        shop_id=shop_id,
        limit=limit,
        cursor_created_at=cursor_created_at,
        cursor_id=cursor_id,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
    )


@router.post(
    "/bills/details",
    response_model=list[BillRead],
    response_model_exclude_unset=True,
    summary="Get Bill Details Batch",
)
async def bill_details(
    payload: BillDetailBatchRequest,
    db: DBSession,
) -> list[BillRead]:
    """Full bill details for a print batch, returned in request order."""
    return await get_bills_by_ids(db, payload.bill_ids)


@router.get(
    "/bills/{bill_id}",
    response_model=BillRead,
    response_model_exclude_unset=True,
    summary="Get Bill Detail",
)
async def bill_detail(
    bill_id: UUID,
    db: DBSession,
) -> BillRead:
    """Full bill detail including line items, payment breakdown, and receipt."""
    return await get_bill_by_id(db, bill_id)


# ── Pricing ───────────────────────────────────────────────────────────────────


@router.get(
    "/shops/{shop_id}/prices/bootstrap",
    response_model=ShopBootstrapResponse,
    response_model_exclude_unset=True,
    summary="Get Shop Price Bootstrap",
)
async def shop_prices_bootstrap(
    shop: ShopDep,
    db: DBSession,
) -> ShopBootstrapResponse:
    """Allocated active items with current prices for the shop price and billing screens."""
    return await get_shop_bootstrap(db, shop)


@router.get(
    "/shops/{shop_id}/prices/history",
    response_model=ShopBootstrapResponse,
    response_model_exclude_unset=True,
    summary="Get Shop Price History",
)
async def shop_price_history(
    shop: ShopDep,
    db: DBSession,
    price_date: PriceHistoryDateParam,
) -> ShopBootstrapResponse:
    """Allocated active items with prices saved on one exact day."""
    return await get_shop_price_history(db, shop, price_date)


@router.post(
    "/shops/{shop_id}/daily-prices",
    response_model=list[DailyPriceRead],
    status_code=201,
    response_model_exclude_unset=True,
    summary="Save Shop Daily Prices",
)
async def shop_daily_prices(
    payload: DailyPriceCreate,
    shop: ShopDep,
    db: DBSession,
) -> list[DailyPriceRead]:
    """Create or update today's prices for every allocated active item in the shop.

    All allocated active items must have a price entry in the payload — partial
    submissions are rejected with 422.
    """
    return await create_daily_prices(db, shop, payload)


@router.patch(
    "/shops/{shop_id}/daily-prices",
    response_model=list[DailyPriceRead],
    status_code=200,
    response_model_exclude_unset=True,
    summary="Save Edited Shop Daily Prices",
)
async def shop_daily_prices_partial(
    payload: DailyPriceCreate,
    shop: ShopDep,
    db: DBSession,
) -> list[DailyPriceRead]:
    """Create or update today's prices for the submitted active allocated items only."""
    return await create_partial_daily_prices(db, shop, payload)


@router.put(
    "/shops/{shop_id}/daily-prices/{item_id}",
    response_model=DailyPriceRead,
    status_code=200,
    response_model_exclude_unset=True,
    summary="Save One Shop Daily Price",
)
async def shop_daily_price(
    item_id: UUID,
    payload: DailyPriceUpdate,
    shop: ShopDep,
    db: DBSession,
) -> DailyPriceRead:
    """Create or update today's price for one active allocated item."""
    return await upsert_shop_daily_price(db, shop, item_id, payload)


@router.get(
    "/prices/bootstrap",
    response_model=ShopBootstrapResponse,
    response_model_exclude_unset=True,
    summary="Get Global Price Bootstrap",
)
async def global_prices_bootstrap(
    db: DBSession,
) -> ShopBootstrapResponse:
    """Active items with the latest global price snapshot for the admin UI."""
    return await get_global_bootstrap(db)


@router.post(
    "/daily-prices",
    response_model=list[DailyPriceRead],
    status_code=201,
    response_model_exclude_unset=True,
    summary="Save Global Daily Prices",
)
async def global_daily_prices(
    payload: DailyPriceCreate,
    db: DBSession,
) -> list[DailyPriceRead]:
    """Set daily prices globally for all active shops."""
    return await create_global_daily_prices(db, payload)


# ── Dashboard ─────────────────────────────────────────────────────────────────


@router.get(
    "/dashboard/bootstrap",
    response_model=AdminDashboardBootstrap,
    response_model_exclude_unset=True,
    summary="Get Dashboard Bootstrap",
)
async def dashboard_bootstrap(
    period: AnalyticsPeriodParam = "date",
    reference_date: ReferenceDateParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    shop_id: Annotated[
        UUID | None, Query(description="Optionally scope the dashboard to one shop branch.")
    ] = None,
    bills_limit: DashboardBillsLimitParam = 50,
    db: DBSession = None,
) -> AdminDashboardBootstrap:
    """Return the admin dashboard bootstrap payload in a single request.

    The response is designed to hydrate the dashboard screen with branch
    metadata, chart summaries, the first page of bills, and item-sales data.
    """
    return await get_dashboard_bootstrap(
        db,
        period,
        reference_date,
        shop_id,
        bills_limit=bills_limit,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
    )


# ── Transfers ─────────────────────────────────────────────────────────────────


@router.get(
    "/transfer-shops",
    response_model=list[TransferShopRead],
    summary="List Transfer Shops",
)
async def admin_list_transfer_shops(
    db: DBSession,
    q: str | None = None,
    active: bool | None = None,
) -> list[TransferShopRead]:
    return await list_transfer_shops(db, q=q, active=active)


@router.post(
    "/transfer-shops",
    response_model=TransferShopRead,
    status_code=201,
    summary="Create Transfer Shop",
)
async def admin_create_transfer_shop(
    payload: TransferShopCreate,
    db: DBSession,
    user: User = Depends(get_current_user),
) -> TransferShopRead:
    return await create_transfer_shop(db, payload, user_id=user.id)


@router.patch(
    "/transfer-shops/{transfer_shop_id}",
    response_model=TransferShopRead,
    summary="Update Transfer Shop",
)
async def admin_update_transfer_shop(
    transfer_shop_id: UUID,
    payload: TransferShopUpdate,
    db: DBSession,
    user: User = Depends(get_current_user),
) -> TransferShopRead:
    return await update_transfer_shop(db, transfer_shop_id, payload, user_id=user.id)


@router.get(
    "/inventory/transfers",
    response_model=InventoryTransferPage,
    summary="List Inventory Transfers",
)
async def admin_list_inventory_transfers(
    db: DBSession,
    transfer_shop_id: UUID | None = None,
    source_shop_id: UUID | None = None,
    inventory_item_id: UUID | None = None,
    reference_date: ReferenceDateParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    limit: int = 100,
    offset: int = 0,
) -> InventoryTransferPage:
    return await list_inventory_transfers(
        db,
        transfer_shop_id=transfer_shop_id,
        source_shop_id=source_shop_id,
        inventory_item_id=inventory_item_id,
        reference_date=reference_date,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        limit=limit,
        offset=offset,
    )
