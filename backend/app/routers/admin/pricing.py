from app.routers.admin._common import *
from app.routers.admin._params import *

router = APIRouter()

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
    submissions are rejected with 422. Publishes the price book for shop billing.
    """
    return await create_daily_prices(db, shop, payload, publish=True)


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
