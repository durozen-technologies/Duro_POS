from app.routers.admin._common import *
from app.routers.admin._common import _require_org_id
from app.routers.admin._params import *

router = APIRouter()

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
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    shop_id: ShopIdParam = None,
    db: DBSession = None,
    current_user: AdminUserDep = None,
) -> list[ShopSalesSummary]:
    """Total revenue grouped by shop for the requested time window.

    Available as a standalone reporting endpoint. The admin dashboard
    bootstrap already includes this data via ``GET /dashboard/bootstrap``.
    """
    return await get_shop_sales_summary(
        db,
        period,
        reference_date,
        shop_id,
        range_start_date,
        range_end_date,
        organization_id=_require_org_id(current_user),
    )


@router.get(
    "/payment-summary",
    response_model=list[PaymentSplitSummary],
    response_model_exclude_unset=True,
    summary="Get Payment Split Summary",
)
async def payment_summary(
    period: AnalyticsPeriodParam = "date",
    reference_date: ReferenceDateParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    shop_id: ShopIdParam = None,
    db: DBSession = None,
    current_user: AdminUserDep = None,
) -> list[PaymentSplitSummary]:
    """Cash/UPI payment split grouped by shop for the requested time window.

    Available as a standalone reporting endpoint. The admin dashboard
    bootstrap already includes this data via ``GET /dashboard/bootstrap``.
    """
    return await get_payment_split_summary(
        db,
        period,
        reference_date,
        shop_id,
        range_start_date,
        range_end_date,
        organization_id=_require_org_id(current_user),
    )


@router.get(
    "/item-sales",
    response_model=list[ItemSalesSummary],
    response_model_exclude_unset=True,
    summary="Get Item Sales Summary",
)
async def item_sales(
    period: AnalyticsPeriodParam = "date",
    reference_date: ReferenceDateParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    shop_id: ShopIdParam = None,
    limit: ItemsLimitParam = 100,
    db: DBSession = None,
    current_user: AdminUserDep = None,
) -> list[ItemSalesSummary]:
    """Quantity sold and revenue grouped by item for the requested time window.

    Only items that appear in at least one bill within the window are returned.
    Available as a standalone reporting endpoint. The admin dashboard
    bootstrap already includes this data via ``GET /dashboard/bootstrap``.
    """
    return await get_item_sales_summary(
        db,
        period,
        reference_date,
        shop_id,
        limit,
        range_start_date,
        range_end_date,
        organization_id=_require_org_id(current_user),
    )


@router.get("/reports/pdf", summary="Generate Admin PDF Report")
async def admin_report_pdf(
    sections: ReportSectionsParam,
    detail_level: ReportDetailLevelParam = "summary",
    period: AnalyticsPeriodParam = "date",
    reference_date: ReferenceDateParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    shop_ids: ShopIdsParam = None,
    retailer_ids: RetailerIdsParam = None,
    language: ReportLanguageParam = "en",
    db: DBSession = None,
    current_user: AdminUserDep = None,
) -> StreamingResponse:
    """Generate a merged PDF report server-side for the selected admin sections."""
    report = await generate_admin_report_pdf(
        db,
        sections=sections,
        detail_level=detail_level,
        period=period,
        reference_date=reference_date,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        shop_ids=shop_ids,
        retailer_ids=retailer_ids,
        organization_id=_require_org_id(current_user),
        language=language,
    )
    return StreamingResponse(
        iter_admin_report_file(report.file),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{report.filename}"'},
    )


@router.get("/reports/overall", response_model=OverallReportRead, summary="Preview Overall Report")
async def admin_overall_report(
    detail_level: ReportDetailLevelParam = "summary",
    period: AnalyticsPeriodParam = "date",
    reference_date: ReferenceDateParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    shop_ids: ShopIdsParam = None,
    db: DBSession = None,
    current_user: AdminUserDep = None,
) -> OverallReportRead:
    """Return the calculated Overall Report statement data for app preview."""
    return await build_overall_report(
        db,
        detail_level=detail_level,
        period=period,
        reference_date=reference_date,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        shop_ids=shop_ids,
        organization_id=_require_org_id(current_user),
    )
