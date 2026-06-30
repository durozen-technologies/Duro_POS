from app.routers.admin._common import *
from app.routers.admin._common import _require_org_id
from app.routers.admin._params import *

router = APIRouter()

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
async def get_shops(db: DBSession, current_user: AdminUserDep) -> list[ShopRead]:
    """Return every shop branch visible in the admin console."""
    return await list_shops(db, _require_org_id(current_user))


@router.get(
    "/shops/{shop_id}",
    response_model=ShopRead,
    response_model_exclude_unset=True,
    summary="Get Shop",
)
async def get_shop(shop_id: UUID, db: DBSession, current_user: AdminUserDep) -> ShopRead:
    """Fetch a single shop branch by its ID."""
    return await get_shop_by_id(db, shop_id, _require_org_id(current_user))


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
    current_user: AdminUserDep,
) -> ShopRead:
    """Update shop metadata and its linked login credentials."""
    return await update_shop_account(db, shop_id, _require_org_id(current_user), payload)


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
    current_user: AdminUserDep,
) -> ShopRead:
    """Enable or disable a shop and its linked shop-account user."""
    return await set_shop_active_state(
        db, shop_id, _require_org_id(current_user), payload.is_active
    )


@router.delete("/shops/{shop_id}", status_code=204, summary="Delete Shop Account")
async def delete_shop(
    shop_id: UUID,
    db: DBSession,
    current_user: AdminUserDep,
) -> Response:
    """Delete a shop only when it has no billing or price history."""
    await delete_shop_account(db, shop_id, _require_org_id(current_user))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
