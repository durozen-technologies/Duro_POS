"""Admin API routes for shop management, analytics, pricing, and dashboard data.

These handlers are intentionally thin: authentication/authorization and
request-shape concerns live at the router layer, while business logic and
query optimization stay in the service layer.
"""

from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_roles
from app.core.deps import get_current_admin, get_shop_or_404
from app.db.database import get_db
from app.db.storage import upload_item_image
from app.models import BaseUnit, Shop, UnitType, User, UserRole
from app.schemas.admin import (
    AdminBillPage,
    AdminDashboardBootstrap,
    AnalyticsPeriod,
    ItemCreate,
    ItemRead,
    ItemSalesSummary,
    ItemUpdate,
    PaymentSplitSummary,
    ShopCreate,
    ShopRead,
    ShopSalesSummary,
    ShopStatusUpdate,
    ShopUpdate,
)
from app.schemas.billing import BillRead
from app.schemas.pricing import (
    DailyPriceCreate,
    DailyPriceRead,
    ItemImageRead,
    ShopBootstrapResponse,
)
from app.services.admin import (
    create_item,
    create_shop_account,
    delete_item,
    delete_shop_account,
    get_bill_by_id,
    get_daily_bills,
    get_dashboard_bootstrap,
    get_item_sales_summary,
    get_payment_split_summary,
    get_shop_by_id,
    get_shop_sales_summary,
    list_shops,
    set_shop_active_state,
    update_item,
    update_shop_account,
)
from app.services.pricing import (
    create_daily_prices,
    create_global_daily_prices,
    get_global_bootstrap,
    get_shop_bootstrap,
)

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


@router.post(
    "/items",
    response_model=ItemRead,
    status_code=201,
    summary="Create Item",
    description=(
        "Create a new inventory item. Submit multipart form-data with the item fields and an optional "
        "`image` file. The image bytes are stored in RustFS, while the image metadata and object key are "
        "stored on the item row in Postgres."
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
    db: DBSession,
    is_active: Annotated[
        bool,
        Form(
            description="Whether the item should be available for pricing and billing immediately."
        ),
    ] = True,
    image: ItemImageUploadOptional = None,
) -> ItemRead:
    """Create a new inventory item for pricing and billing, with an optional image upload."""
    payload = ItemCreate(
        name=name,
        unit_type=unit_type,
        base_unit=base_unit,
        is_active=is_active,
    )
    return await create_item(db, payload, image=image)


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
    db: DBSession,
    is_active: Annotated[
        bool,
        Form(description="Whether the item remains available for pricing and billing."),
    ],
    image: ItemImageUploadOptional = None,
) -> ItemRead:
    """Update item metadata, active state, and optionally replace its image."""
    payload = ItemUpdate(
        name=name,
        unit_type=unit_type,
        base_unit=base_unit,
        is_active=is_active,
    )
    return await update_item(db, item_id, payload, image=image)


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
    """Active items with current prices for the shop — used to bootstrap the billing and price-setup screens."""
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
    """Create or update today's prices for every active item in the shop.

    All active items must have a price entry in the payload — partial
    submissions are rejected with 422.
    """
    return await create_daily_prices(db, shop, payload)


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
