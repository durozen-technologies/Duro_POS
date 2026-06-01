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
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_roles
from app.core.deps import get_current_admin, get_shop_or_404
from app.db.database import get_db
from app.db.storage import upload_item_image
from app.models import BaseUnit, Shop, UnitType, User, UserRole
from app.schemas.admin import (
    AdminBillPage,
    AdminDashboardBootstrap,
    AdminItemRowsPage,
    AnalyticsPeriod,
    ItemCategoryCreate,
    ItemCategoryRead,
    ItemCreate,
    ItemMetadataUpdate,
    ItemRead,
    ItemSalesSummary,
    ItemScope,
    ItemUpdate,
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
    ShopStatusUpdate,
    ShopUpdate,
)
from app.schemas.billing import BillRead
from app.schemas.pricing import (
    DailyPriceCreate,
    DailyPriceRead,
    DailyPriceUpdate,
    ItemImageRead,
    ShopBootstrapResponse,
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
    update_item_metadata,
    update_shop_account,
)
from app.services.pricing import (
    create_daily_prices,
    create_global_daily_prices,
    create_partial_daily_prices,
    get_global_bootstrap,
    get_shop_bootstrap,
    upsert_shop_daily_price,
)
from app.services.storage import delete_item_image

router = APIRouter(tags=["Admin"], dependencies=[Depends(require_roles(UserRole.ADMIN))])

AnalyticsPeriodParam = Annotated[
    AnalyticsPeriod,
    Query(description="Aggregation window: `date`, `month`, `week`, or `year`."),
]
ReferenceDateParam = Annotated[
    date | None,
    Query(description="Anchor date used to resolve the selected period."),
]
ShopIdParam = Annotated[
    UUID | None,
    Query(description="Filter results to a single shop branch."),
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


@router.delete(
    "/item-categories/{category_id}",
    status_code=204,
    summary="Delete Item Category",
)
async def delete_admin_item_category(category_id: UUID, db: DBSession) -> Response:
    """Delete a category and clear it from assigned catalogue items."""
    await delete_item_category(db, category_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
) -> ShopItemCounts:
    """Return exact selected shop item counts for background UI badges."""
    return await count_selected_shop_items(db, shop, q=q)


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
    shop_id: ShopIdParam = None,
    db: DBSession = None,
) -> list[ShopSalesSummary]:
    """Total revenue grouped by shop for the requested time window.

    Available as a standalone reporting endpoint. The admin dashboard
    bootstrap already includes this data via ``GET /dashboard/bootstrap``.
    """
    return await get_shop_sales_summary(db, period, reference_date, shop_id)


@router.get(
    "/payment-summary",
    response_model=list[PaymentSplitSummary],
    response_model_exclude_unset=True,
    summary="Get Payment Split Summary",
)
async def payment_summary(
    period: AnalyticsPeriodParam = "date",
    reference_date: ReferenceDateParam = None,
    shop_id: ShopIdParam = None,
    db: DBSession = None,
) -> list[PaymentSplitSummary]:
    """Cash/UPI payment split grouped by shop for the requested time window.

    Available as a standalone reporting endpoint. The admin dashboard
    bootstrap already includes this data via ``GET /dashboard/bootstrap``.
    """
    return await get_payment_split_summary(db, period, reference_date, shop_id)


@router.get(
    "/item-sales",
    response_model=list[ItemSalesSummary],
    response_model_exclude_unset=True,
    summary="Get Item Sales Summary",
)
async def item_sales(
    period: AnalyticsPeriodParam = "date",
    reference_date: ReferenceDateParam = None,
    shop_id: ShopIdParam = None,
    limit: ItemsLimitParam = 100,
    db: DBSession = None,
) -> list[ItemSalesSummary]:
    """Quantity sold and revenue grouped by item for the requested time window.

    Only items that appear in at least one bill within the window are returned.
    Available as a standalone reporting endpoint. The admin dashboard
    bootstrap already includes this data via ``GET /dashboard/bootstrap``.
    """
    return await get_item_sales_summary(db, period, reference_date, shop_id, limit)


# ── Bills ─────────────────────────────────────────────────────────────────────


@router.get(
    "/bills", response_model=AdminBillPage, response_model_exclude_unset=True, summary="List Bills"
)
async def bills(
    period: AnalyticsPeriodParam = "date",
    reference_date: ReferenceDateParam = None,
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
    )


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
        db, period, reference_date, shop_id, bills_limit=bills_limit
    )
