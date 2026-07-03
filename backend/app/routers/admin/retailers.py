from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.auth.permission_codes import RETAILERS_MANAGE, RETAILERS_READ
from app.auth.tenant_context import TenantContext, require_permission
from app.models import RetailerSaleStatus
from app.routers.admin._params import DBSession
from app.schemas.retailers import (
    RetailerBalanceRead,
    RetailerBranchAllocationRead,
    RetailerBranchAllocationSync,
    RetailerCreate,
    RetailerItemPriceRead,
    RetailerItemPriceSync,
    RetailerPage,
    RetailerPaymentCreate,
    RetailerPaymentRecordResponse,
    RetailerRead,
    RetailerSalePage,
    RetailerSaleRead,
    RetailerSaleReceiptPage,
    RetailerSaleReceiptRead,
    RetailerUpdate,
)
from app.services.retailer_sales import (
    get_retailer_sale,
    get_retailer_sale_receipt,
    list_retailer_sale_receipts,
    list_retailer_sales,
    record_retailer_payment,
)
from app.services.retailers import (
    create_retailer,
    get_retailer_balance,
    list_retailer_branch_allocations,
    list_retailer_item_prices,
    list_retailers,
    sync_retailer_branch_allocations,
    sync_retailer_item_prices,
    update_retailer,
)

router = APIRouter()


@router.get(
    "/retailers",
    response_model=RetailerPage,
    dependencies=[Depends(require_permission(RETAILERS_READ))],
    summary="List retailers",
)
async def admin_list_retailers(
    db: DBSession,
    q: Annotated[str | None, Query(max_length=120)] = None,
    active: Annotated[bool | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> RetailerPage:
    return await list_retailers(db, q=q, active=active, page=page, page_size=page_size)


@router.post(
    "/retailers",
    response_model=RetailerRead,
    status_code=201,
    dependencies=[Depends(require_permission(RETAILERS_MANAGE))],
    summary="Create retailer",
)
async def admin_create_retailer(
    payload: RetailerCreate,
    db: DBSession,
) -> RetailerRead:
    return await create_retailer(db, payload)


@router.patch(
    "/retailers/{retailer_id}",
    response_model=RetailerRead,
    dependencies=[Depends(require_permission(RETAILERS_MANAGE))],
    summary="Update retailer",
)
async def admin_update_retailer(
    retailer_id: UUID,
    payload: RetailerUpdate,
    db: DBSession,
) -> RetailerRead:
    return await update_retailer(db, retailer_id, payload)


@router.get(
    "/retailers/{retailer_id}/items",
    response_model=list[RetailerItemPriceRead],
    dependencies=[Depends(require_permission(RETAILERS_READ))],
    summary="List retailer item prices",
)
async def admin_list_retailer_items(
    retailer_id: UUID,
    db: DBSession,
) -> list[RetailerItemPriceRead]:
    return await list_retailer_item_prices(db, retailer_id)


@router.put(
    "/retailers/{retailer_id}/items",
    response_model=list[RetailerItemPriceRead],
    dependencies=[Depends(require_permission(RETAILERS_MANAGE))],
    summary="Sync retailer item prices",
)
async def admin_sync_retailer_items(
    retailer_id: UUID,
    payload: RetailerItemPriceSync,
    db: DBSession,
) -> list[RetailerItemPriceRead]:
    return await sync_retailer_item_prices(db, retailer_id, payload.items)


@router.get(
    "/retailers/{retailer_id}/balance",
    response_model=RetailerBalanceRead,
    dependencies=[Depends(require_permission(RETAILERS_READ))],
    summary="Retailer outstanding balance",
)
async def admin_retailer_balance(
    retailer_id: UUID,
    db: DBSession,
) -> RetailerBalanceRead:
    return await get_retailer_balance(db, retailer_id)


@router.get(
    "/retailers/{retailer_id}/branches",
    response_model=list[RetailerBranchAllocationRead],
    dependencies=[Depends(require_permission(RETAILERS_READ))],
    summary="List retailer branch allocations",
)
async def admin_list_retailer_branches(
    retailer_id: UUID,
    db: DBSession,
) -> list[RetailerBranchAllocationRead]:
    return await list_retailer_branch_allocations(db, retailer_id)


@router.put(
    "/retailers/{retailer_id}/branches",
    response_model=list[RetailerBranchAllocationRead],
    dependencies=[Depends(require_permission(RETAILERS_MANAGE))],
    summary="Sync retailer branch allocations",
)
async def admin_sync_retailer_branches(
    retailer_id: UUID,
    payload: RetailerBranchAllocationSync,
    db: DBSession,
) -> list[RetailerBranchAllocationRead]:
    return await sync_retailer_branch_allocations(db, retailer_id, payload.shop_ids)


@router.get(
    "/retailer-sales",
    response_model=RetailerSalePage,
    dependencies=[Depends(require_permission(RETAILERS_READ))],
    summary="List retailer sales",
)
async def admin_list_retailer_sales(
    db: DBSession,
    shop_id: Annotated[UUID | None, Query()] = None,
    retailer_id: Annotated[UUID | None, Query()] = None,
    status_filter: Annotated[RetailerSaleStatus | None, Query(alias="status")] = None,
    start_date: Annotated[date | None, Query()] = None,
    end_date: Annotated[date | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> RetailerSalePage:
    return await list_retailer_sales(
        db,
        shop_id=shop_id,
        retailer_id=retailer_id,
        status_filter=status_filter,
        start_date=start_date,
        end_date=end_date,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/retailer-sales/{sale_id}",
    response_model=RetailerSaleRead,
    dependencies=[Depends(require_permission(RETAILERS_READ))],
    summary="Get retailer sale",
)
async def admin_get_retailer_sale(
    sale_id: UUID,
    db: DBSession,
) -> RetailerSaleRead:
    return await get_retailer_sale(db, sale_id)


@router.post(
    "/retailer-sales/{sale_id}/payments",
    response_model=RetailerPaymentRecordResponse,
    dependencies=[Depends(require_permission(RETAILERS_MANAGE))],
    summary="Record retailer payment (admin)",
)
async def admin_record_retailer_payment(
    sale_id: UUID,
    payload: RetailerPaymentCreate,
    db: DBSession,
    ctx: Annotated[TenantContext, Depends(require_permission(RETAILERS_MANAGE))],
) -> RetailerPaymentRecordResponse:
    return await record_retailer_payment(
        db,
        shop=None,
        user=ctx.actor,
        sale_id=sale_id,
        payload=payload,
        admin_override=True,
    )


@router.get(
    "/retailer-sales/{sale_id}/receipts",
    response_model=RetailerSaleReceiptPage,
    dependencies=[Depends(require_permission(RETAILERS_READ))],
    summary="List retailer sale receipts",
)
async def admin_list_retailer_sale_receipts(
    sale_id: UUID,
    db: DBSession,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> RetailerSaleReceiptPage:
    return await list_retailer_sale_receipts(db, sale_id, page=page, page_size=page_size)


@router.get(
    "/retailer-sales/{sale_id}/receipts/{receipt_id}",
    response_model=RetailerSaleReceiptRead,
    dependencies=[Depends(require_permission(RETAILERS_READ))],
    summary="Get retailer sale receipt",
)
async def admin_get_retailer_sale_receipt(
    sale_id: UUID,
    receipt_id: UUID,
    db: DBSession,
) -> RetailerSaleReceiptRead:
    return await get_retailer_sale_receipt(db, sale_id, receipt_id)
