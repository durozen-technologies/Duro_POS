from app.routers.admin._common import *
from app.routers.admin._common import _require_org_id
from app.routers.admin._params import *

router = APIRouter()

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
    current_user: AdminUserDep = None,
) -> AdminDashboardBootstrap:
    """Return the admin dashboard bootstrap payload in a single request.

    The response is designed to hydrate the dashboard screen with branch
    metadata, chart summaries, the first page of bills, and item-sales data.
    """
    return await get_dashboard_bootstrap(
        db,
        _require_org_id(current_user),
        period,
        reference_date,
        shop_id,
        bills_limit=bills_limit,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
    )
