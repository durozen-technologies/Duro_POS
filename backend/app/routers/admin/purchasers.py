from app.routers.admin._common import *
from app.routers.admin._params import *
from app.schemas.purchaser import PurchaserCreate, PurchaserRead, PurchaserUpdate
from app.services.purchasers import create_purchaser, list_purchasers, update_purchaser

router = APIRouter()


@router.get(
    "/purchasers",
    response_model=list[PurchaserRead],
    summary="List Purchasers",
)
async def admin_list_purchasers(
    db: DBSession,
    q: str | None = None,
    active: bool | None = None,
) -> list[PurchaserRead]:
    return await list_purchasers(db, q=q, active=active)


@router.post(
    "/purchasers",
    response_model=PurchaserRead,
    status_code=201,
    summary="Create Purchaser",
)
async def admin_create_purchaser(
    payload: PurchaserCreate,
    db: DBSession,
    user: User = Depends(get_current_user),
) -> PurchaserRead:
    return await create_purchaser(db, payload, user_id=user.id)


@router.patch(
    "/purchasers/{purchaser_id}",
    response_model=PurchaserRead,
    summary="Update Purchaser",
)
async def admin_update_purchaser(
    purchaser_id: UUID,
    payload: PurchaserUpdate,
    db: DBSession,
    user: User = Depends(get_current_user),
) -> PurchaserRead:
    return await update_purchaser(db, purchaser_id, payload, user_id=user.id)
