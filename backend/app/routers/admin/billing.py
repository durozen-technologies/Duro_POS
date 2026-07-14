from app.routers.admin._common import *
from app.routers.admin._common import _require_org_id
from app.routers.admin._params import *

router = APIRouter()

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
    current_user: AdminUserDep = None,
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
        organization_id=_require_org_id(current_user),
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
    current_user: AdminUserDep = None,
) -> BillRead:
    """Full bill detail including line items, payment breakdown, and receipt."""
    return await get_bill_by_id(db, bill_id, _require_org_id(current_user))


@router.patch(
    "/bills/{bill_id}",
    response_model=BillRead,
    response_model_exclude_unset=True,
    summary="Edit shop bill (admin, 24h window)",
)
async def edit_bill(
    bill_id: UUID,
    payload: BillEditRequest,
    db: DBSession,
    current_user: AdminUserDep = None,
) -> BillRead:
    return await edit_shop_bill(
        db, current_user, bill_id, _require_org_id(current_user), payload
    )


@router.post(
    "/bills/{bill_id}/cancel",
    response_model=BillRead,
    response_model_exclude_unset=True,
    summary="Cancel shop bill (admin, 24h window)",
)
async def cancel_bill(
    bill_id: UUID,
    db: DBSession,
    current_user: AdminUserDep = None,
) -> BillRead:
    return await cancel_shop_bill(db, current_user, bill_id, _require_org_id(current_user))
