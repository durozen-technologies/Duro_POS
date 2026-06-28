from app.routers.admin._common import *
from app.routers.admin._params import *

router = APIRouter()

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
