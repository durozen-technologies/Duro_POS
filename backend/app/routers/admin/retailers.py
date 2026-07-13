from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.auth.permission_codes import RETAILERS_MANAGE, RETAILERS_READ
from app.auth.tenant_context import TenantContext, require_permission
from app.models import RetailerSaleStatus
from app.routers.admin._params import DBSession
from app.schemas.retailer_inventory import RetailerInventoryPurchasePage
from app.schemas.retailers import (
    RetailerBalanceRead,
    RetailerBranchAllocationRead,
    RetailerBranchAllocationSync,
    RetailerCreate,
    RetailerItemAllocationBulkCreate,
    RetailerItemAllocationBulkRead,
    RetailerItemAllocationListRead,
    RetailerItemAllocationUpdate,
    RetailerItemPriceRead,
    RetailerItemPriceSync,
    RetailerOutstandingBalanceUpdate,
    RetailerPage,
    RetailerPaymentCreate,
    RetailerPaymentRecordResponse,
    RetailerRead,
    RetailerSaleEditRequest,
    RetailerSalePage,
    RetailerSaleRead,
    RetailerSaleReceiptPage,
    RetailerSaleReceiptRead,
    RetailerUpdate,
    RetailerWalletPayoutCreate,
    RetailerWalletPayoutRead,
    ShopRetailerCatalogSync,
)
from app.services.retailer_inventory_purchases import list_retailer_inventory_purchases
from app.services.retailer_sales import (
    cancel_retailer_sale,
    edit_retailer_sale,
    get_retailer_sale,
    get_retailer_sale_receipt,
    list_retailer_sale_receipts,
    list_retailer_sales,
    record_retailer_payment,
)
from app.services.retailer_wallet_payouts import record_retailer_wallet_payout
from app.services.retailers import (
    bulk_allocate_retailer_items,
    create_retailer,
    delete_retailer,
    delete_retailer_item_allocation,
    get_retailer_balance,
    list_retailer_branch_allocations,
    list_retailer_item_allocations,
    list_retailer_item_prices,
    list_retailers,
    list_shop_retailer_item_catalog,
    sync_retailer_branch_allocations,
    sync_retailer_item_prices,
    sync_shop_retailer_item_catalog,
    update_retailer,
    update_retailer_item_allocation,
    update_retailer_outstanding_balance,
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
    shop_id: Annotated[UUID | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> RetailerPage:
    return await list_retailers(
        db, q=q, active=active, shop_id=shop_id, page=page, page_size=page_size
    )


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


@router.delete(
    "/retailers/{retailer_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(RETAILERS_MANAGE))],
    summary="Delete retailer",
)
async def admin_delete_retailer(
    retailer_id: UUID,
    db: DBSession,
) -> None:
    await delete_retailer(db, retailer_id)


@router.get(
    "/retailers/{retailer_id}/items",
    response_model=list[RetailerItemPriceRead],
    dependencies=[Depends(require_permission(RETAILERS_READ))],
    summary="List retailer item prices",
)
async def admin_list_retailer_items(
    retailer_id: UUID,
    db: DBSession,
    shop_id: Annotated[UUID, Query()],
) -> list[RetailerItemPriceRead]:
    return await list_retailer_item_prices(db, retailer_id, shop_id=shop_id)


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
    shop_id: Annotated[UUID, Query()],
) -> list[RetailerItemPriceRead]:
    return await sync_retailer_item_prices(db, retailer_id, shop_id, payload.items)


@router.get(
    "/retailers/{retailer_id}/item-allocations",
    response_model=RetailerItemAllocationListRead,
    dependencies=[Depends(require_permission(RETAILERS_READ))],
    summary="List branch billing items with retailer allocation status",
)
async def admin_list_retailer_item_allocations(
    retailer_id: UUID,
    db: DBSession,
    shop_id: Annotated[UUID, Query()],
    q: Annotated[str | None, Query(max_length=120)] = None,
    allocated: Annotated[Literal["allocated", "available"] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    effective_date: Annotated[date | None, Query()] = None,
) -> RetailerItemAllocationListRead:
    return await list_retailer_item_allocations(
        db,
        retailer_id,
        shop_id=shop_id,
        q=q,
        allocated=allocated,
        limit=limit,
        effective_date=effective_date,
    )


@router.post(
    "/retailers/{retailer_id}/item-allocations",
    response_model=RetailerItemAllocationBulkRead,
    status_code=201,
    dependencies=[Depends(require_permission(RETAILERS_MANAGE))],
    summary="Bulk allocate branch billing items to retailer",
)
async def admin_bulk_allocate_retailer_items(
    retailer_id: UUID,
    payload: RetailerItemAllocationBulkCreate,
    db: DBSession,
    shop_id: Annotated[UUID, Query()],
) -> RetailerItemAllocationBulkRead:
    return await bulk_allocate_retailer_items(db, retailer_id, shop_id, payload.items)


@router.patch(
    "/retailers/{retailer_id}/item-allocations/{item_id}",
    response_model=RetailerItemPriceRead,
    dependencies=[Depends(require_permission(RETAILERS_MANAGE))],
    summary="Update retailer item allocation",
)
async def admin_update_retailer_item_allocation(
    retailer_id: UUID,
    item_id: UUID,
    payload: RetailerItemAllocationUpdate,
    db: DBSession,
    shop_id: Annotated[UUID, Query()],
) -> RetailerItemPriceRead:
    return await update_retailer_item_allocation(db, retailer_id, shop_id, item_id, payload)


@router.delete(
    "/retailers/{retailer_id}/item-allocations/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(RETAILERS_MANAGE))],
    summary="Remove retailer item allocation",
)
async def admin_delete_retailer_item_allocation(
    retailer_id: UUID,
    item_id: UUID,
    db: DBSession,
    shop_id: Annotated[UUID, Query()],
) -> None:
    await delete_retailer_item_allocation(db, retailer_id, shop_id, item_id)


@router.get(
    "/shops/{shop_id}/retailer-catalog",
    response_model=RetailerItemAllocationListRead,
    dependencies=[Depends(require_permission(RETAILERS_READ))],
    summary="List billing catalogue items for branch retailer catalog",
)
async def admin_list_shop_retailer_catalog(
    shop_id: UUID,
    db: DBSession,
    q: Annotated[str | None, Query(max_length=120)] = None,
    allocated: Annotated[Literal["allocated", "available"] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> RetailerItemAllocationListRead:
    return await list_shop_retailer_item_catalog(
        db,
        shop_id,
        q=q,
        allocated=allocated,
        limit=limit,
    )


@router.put(
    "/shops/{shop_id}/retailer-catalog",
    response_model=RetailerItemAllocationListRead,
    dependencies=[Depends(require_permission(RETAILERS_MANAGE))],
    summary="Sync branch retailer catalog items",
)
async def admin_sync_shop_retailer_catalog(
    shop_id: UUID,
    payload: ShopRetailerCatalogSync,
    db: DBSession,
) -> RetailerItemAllocationListRead:
    return await sync_shop_retailer_item_catalog(db, shop_id, payload.item_ids)


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


@router.patch(
    "/retailers/{retailer_id}/outstanding-balance",
    response_model=RetailerBalanceRead,
    dependencies=[Depends(require_permission(RETAILERS_MANAGE))],
    summary="Update retailer outstanding balance",
)
async def admin_update_retailer_outstanding_balance(
    retailer_id: UUID,
    payload: RetailerOutstandingBalanceUpdate,
    db: DBSession,
) -> RetailerBalanceRead:
    return await update_retailer_outstanding_balance(
        db,
        retailer_id,
        payload.outstanding_balance,
    )


@router.post(
    "/retailers/{retailer_id}/wallet-payouts",
    response_model=RetailerWalletPayoutRead,
    status_code=201,
    dependencies=[Depends(require_permission(RETAILERS_MANAGE))],
    summary="Record wallet credit payout to retailer",
)
async def admin_record_retailer_wallet_payout(
    retailer_id: UUID,
    payload: RetailerWalletPayoutCreate,
    db: DBSession,
    ctx: Annotated[TenantContext, Depends(require_permission(RETAILERS_MANAGE))],
) -> RetailerWalletPayoutRead:
    return await record_retailer_wallet_payout(db, ctx.actor, retailer_id, payload)


@router.get(
    "/retailers/{retailer_id}/inventory-purchases",
    response_model=RetailerInventoryPurchasePage,
    dependencies=[Depends(require_permission(RETAILERS_READ))],
    summary="List retailer inventory purchases",
)
async def admin_list_retailer_inventory_purchases(
    retailer_id: UUID,
    db: DBSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> RetailerInventoryPurchasePage:
    return await list_retailer_inventory_purchases(db, retailer_id=retailer_id, limit=limit)


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


@router.patch(
    "/retailer-sales/{sale_id}",
    response_model=RetailerSaleRead,
    dependencies=[Depends(require_permission(RETAILERS_MANAGE))],
    summary="Edit retailer sale (admin, 24h window)",
)
async def admin_edit_retailer_sale(
    sale_id: UUID,
    payload: RetailerSaleEditRequest,
    db: DBSession,
    ctx: Annotated[TenantContext, Depends(require_permission(RETAILERS_MANAGE))],
) -> RetailerSaleRead:
    return await edit_retailer_sale(db, ctx.actor, sale_id, payload)


@router.post(
    "/retailer-sales/{sale_id}/cancel",
    response_model=RetailerSaleRead,
    dependencies=[Depends(require_permission(RETAILERS_MANAGE))],
    summary="Cancel retailer sale (admin, 24h window)",
)
async def admin_cancel_retailer_sale(
    sale_id: UUID,
    db: DBSession,
    ctx: Annotated[TenantContext, Depends(require_permission(RETAILERS_MANAGE))],
) -> RetailerSaleRead:
    return await cancel_retailer_sale(db, ctx.actor, sale_id)


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
