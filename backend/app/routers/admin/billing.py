from app.routers.admin._common import *
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
