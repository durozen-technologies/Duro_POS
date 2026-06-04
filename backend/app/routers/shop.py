from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_shop, require_roles
from app.db.database import get_db
from app.models import Shop, UserRole
from app.schemas.billing import (
    BillCheckoutCommitRequest,
    BillCheckoutPreviewRead,
    BillCheckoutRequest,
    BillRead,
)
from app.schemas.inventory import (
    InventoryAddRequest,
    InventoryMovementCreateResult,
    InventoryMovementPage,
    InventoryMovementSplitCreateResult,
    InventorySummaryRead,
    InventoryUseRequest,
    InventoryUseSplitRequest,
)
from app.schemas.pricing import DailyPriceCreate, DailyPriceRead, ShopBootstrapResponse
from app.services.billing import create_bill, preview_bill
from app.services.inventory import (
    add_shop_inventory_stock,
    get_inventory_summary,
    list_inventory_movements,
    use_shop_inventory_stock,
    use_shop_inventory_stock_split,
)
from app.services.pricing import create_daily_prices, get_shop_bootstrap, get_today_prices

router = APIRouter(tags=["Shop"], dependencies=[Depends(require_roles(UserRole.SHOP_ACCOUNT))])


@router.get(
    "/bootstrap",
    response_model=ShopBootstrapResponse,
    response_model_exclude_unset=True,
    summary="Get Shop Bootstrap",
)
async def bootstrap(
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_db),
) -> ShopBootstrapResponse:
    """Return the pricing bootstrap payload for the signed-in shop."""
    return await get_shop_bootstrap(db, shop)


@router.get(
    "/daily-prices/today",
    response_model=list[DailyPriceRead],
    response_model_exclude_unset=True,
    summary="Get Today's Prices",
)
async def today_prices(
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_db),
) -> list[DailyPriceRead]:
    """Return today's saved price rows for the signed-in shop."""
    return await get_today_prices(db, shop)


@router.post(
    "/daily-prices",
    response_model=list[DailyPriceRead],
    status_code=201,
    response_model_exclude_unset=True,
    summary="Save Daily Prices",
)
async def save_daily_prices(
    payload: DailyPriceCreate,
    db: AsyncSession = Depends(get_db),
    shop: Shop = Depends(get_current_shop),
) -> list[DailyPriceRead]:
    """Create or update today's price book for the signed-in shop."""
    return await create_daily_prices(db, shop, payload)


@router.get(
    "/inventory",
    response_model=InventorySummaryRead,
    response_model_exclude_unset=True,
    summary="Get Shop Inventory",
)
async def shop_inventory(
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_db),
) -> InventorySummaryRead:
    """Return allocated inventory items and stock totals for the signed-in shop."""
    return await get_inventory_summary(db, shop, active_allocations_only=True)


@router.get(
    "/inventory/movements",
    response_model=InventoryMovementPage,
    response_model_exclude_unset=True,
    summary="List Shop Inventory Movements",
)
async def shop_inventory_movements(
    limit: int = Query(30, ge=1, le=100),
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_db),
) -> InventoryMovementPage:
    """Return recent inventory movements for the signed-in shop."""
    return await list_inventory_movements(db, shop_id=shop.id, limit=limit)


@router.post(
    "/inventory/items/{item_id}/add",
    response_model=InventoryMovementCreateResult,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Add Inventory Stock",
)
async def add_inventory_stock(
    item_id: UUID,
    payload: InventoryAddRequest,
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_db),
) -> InventoryMovementCreateResult:
    """Add kg/unit stock to an allocated inventory item."""
    return await add_shop_inventory_stock(db, shop, item_id, payload)


@router.post(
    "/inventory/items/{item_id}/use",
    response_model=InventoryMovementCreateResult,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Use Inventory Stock",
)
async def use_inventory_stock(
    item_id: UUID,
    payload: InventoryUseRequest,
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_db),
) -> InventoryMovementCreateResult:
    """Use kg/unit stock from an allocated inventory item by category."""
    return await use_shop_inventory_stock(db, shop, item_id, payload)


@router.post(
    "/inventory/items/{item_id}/use-split",
    response_model=InventoryMovementSplitCreateResult,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Use Inventory Stock Split By Category",
)
async def use_inventory_stock_split(
    item_id: UUID,
    payload: InventoryUseSplitRequest,
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_db),
) -> InventoryMovementSplitCreateResult:
    """Use kg/unit stock from an allocated inventory item split across categories."""
    return await use_shop_inventory_stock_split(db, shop, item_id, payload)


@router.post(
    "/bills/preview",
    response_model=BillCheckoutPreviewRead,
    status_code=200,
    response_model_exclude_unset=True,
    summary="Preview Bill",
)
async def preview_checkout(
    payload: BillCheckoutRequest,
    db: AsyncSession = Depends(get_db),
    shop: Shop = Depends(get_current_shop),
) -> BillCheckoutPreviewRead:
    """Validate and build a printable bill without saving billing data."""
    return await preview_bill(db, shop, payload)


@router.post(
    "/bills",
    response_model=BillRead,
    status_code=201,
    response_model_exclude_unset=True,
    summary="Checkout Bill",
)
async def checkout(
    payload: BillCheckoutCommitRequest,
    db: AsyncSession = Depends(get_db),
    shop: Shop = Depends(get_current_shop),
) -> BillRead:
    """Save a paid bill after the signed-in shop has printed its receipt."""
    return await create_bill(db, shop, payload)
