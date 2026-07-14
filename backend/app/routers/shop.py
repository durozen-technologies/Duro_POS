from datetime import date, datetime
from decimal import Decimal
from typing import Sequence
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_shop, get_current_user, require_roles
from app.db.tenant_session import get_tenant_db
from app.models import Shop, User, UserRole
from app.models.enums import ReceiptStatus
from app.schemas.billing import (
    BillCheckoutCommitRequest,
    BillCheckoutPreviewRead,
    BillCheckoutRequest,
    BillRead,
    BillReceiptStatusUpdate,
    ShopBillPage,
    ShopBillPaymentMethodFilter,
    ShopBillSortField,
)
from app.schemas.expenses import (
    ExpenseEntryCreate,
    ExpenseEntryPage,
    ExpenseEntryRead,
    ShopExpenseItemRowsPage,
)
from app.schemas.inventory import (
    InventoryAddRequest,
    InventoryMovementCreateResult,
    InventoryMovementPage,
    InventoryMovementSplitCreateResult,
    InventoryStockRowsPage,
    InventorySummaryRead,
    InventoryUseRequest,
    InventoryUseSplitRequest,
)
from app.schemas.inventory_policy import InventoryBackdatePolicyRead
from app.schemas.pricing import DailyPriceCreate, DailyPriceRead, ShopBootstrapResponse
from app.schemas.retailer_inventory import (
    RetailerInventoryPurchaseCreate,
    RetailerInventoryPurchasePage,
    RetailerInventoryPurchaseRead,
    RetailerInventoryUsageBulkCreate,
    RetailerInventoryUsageBulkResult,
    RetailerInventoryUsagePage,
)
from app.schemas.retailers import (
    RetailerCatalogItemRead,
    RetailerPaymentCreate,
    RetailerPaymentRecordResponse,
    RetailerRead,
    RetailerSaleCheckoutCommitRequest,
    RetailerSaleCheckoutRequest,
    RetailerSalePage,
    RetailerSalePreviewRead,
    RetailerSaleRead,
    RetailerSaleReceiptPage,
    RetailerSaleReceiptRead,
    RetailerWalletRead,
)
from app.schemas.transfer import (
    InventoryTransferCreate,
    InventoryTransferPage,
    InventoryTransferRead,
    TransferShopRead,
)
from app.services.billing import (
    begin_bill_reprint,
    create_bill,
    preview_bill,
    update_bill_receipt_status,
)
from app.services.expenses import (
    create_shop_expense_entry,
    list_current_shop_expense_items,
    list_expense_entries,
)
from app.services.inventory import (
    add_shop_inventory_stock,
    get_inventory_summary,
    list_inventory_movements,
    list_inventory_stock_rows,
    list_inventory_transfers,
    use_shop_inventory_stock,
    use_shop_inventory_stock_split,
)
from app.services.inventory_policy import get_inventory_backdate_policy
from app.services.pricing import create_daily_prices, get_shop_bootstrap, get_today_prices
from app.services.retailer_inventory import (
    list_retailer_inventory_usages,
    record_retailer_inventory_usages_bulk,
)
from app.services.retailer_inventory_purchases import (
    create_retailer_inventory_purchase,
    list_retailer_inventory_purchases,
    void_retailer_inventory_purchase,
)
from app.services.retailer_sales import (
    create_retailer_sale,
    get_retailer_catalog,
    get_retailer_sale,
    get_retailer_sale_receipt,
    list_retailer_sale_receipts,
    list_retailer_sales,
    preview_retailer_sale,
    record_retailer_payment,
)
from app.services.retailers import get_shop_retailer_wallet, list_active_retailers_for_shop
from app.services.shop_billing import get_shop_bill, list_shop_bills
from app.services.transfer import create_inventory_transfer, list_transfer_shops

router = APIRouter(tags=["Shop"], dependencies=[Depends(require_roles(UserRole.SHOP_ACCOUNT))])


@router.get(
    "/bootstrap",
    response_model=ShopBootstrapResponse,
    response_model_exclude_unset=True,
    summary="Get Shop Bootstrap",
)
async def bootstrap(
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_tenant_db),
) -> ShopBootstrapResponse:
    """Return the pricing bootstrap payload for the signed-in shop."""
    return await get_shop_bootstrap(db, shop)


@router.get(
    "/daily-prices/today",
    response_model=list[DailyPriceRead],
    response_model_exclude_unset=True,
    summary="Get Today's Prices",
)
async def today_prices(
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_tenant_db),
) -> list[DailyPriceRead]:
    """Return today's saved price rows for the signed-in shop."""
    return await get_today_prices(db, shop)


@router.post(
    "/daily-prices",
    response_model=list[DailyPriceRead],
    status_code=201,
    response_model_exclude_unset=True,
    summary="Save Daily Prices",
)
async def save_daily_prices(
    payload: DailyPriceCreate,
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
) -> list[DailyPriceRead]:
    """Create or update today's price book for the signed-in shop."""
    return await create_daily_prices(db, shop, payload)


@router.get(
    "/inventory",
    response_model=InventorySummaryRead,
    response_model_exclude_unset=True,
    summary="Get Shop Inventory",
)
async def shop_inventory(
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_tenant_db),
) -> InventorySummaryRead:
    """Return allocated inventory items and stock totals for the signed-in shop."""
    return await get_inventory_summary(db, shop, active_allocations_only=True)


@router.get(
    "/inventory/items/rows",
    response_model=InventoryStockRowsPage,
    response_model_exclude_unset=True,
    summary="List Shop Inventory Item Rows",
)
async def shop_inventory_rows(
    q: str | None = Query(None, min_length=1, max_length=120),
    limit: int = Query(50, ge=1, le=200),
    cursor_sort_order: int | None = Query(None),
    cursor_name: str | None = Query(None, max_length=120),
    cursor_id: UUID | None = Query(None),
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_tenant_db),
) -> InventoryStockRowsPage:
    """Return a paged stock row set for the signed-in shop."""
    return await list_inventory_stock_rows(
        db,
        shop,
        q=q,
        active_allocations_only=True,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/inventory/movements",
    response_model=InventoryMovementPage,
    response_model_exclude_unset=True,
    summary="List Shop Inventory Movements",
)
async def shop_inventory_movements(
    reference_date: date | None = Query(None),
    range_start_date: date | None = Query(None),
    range_end_date: date | None = Query(None),
    limit: int = Query(30, ge=1, le=100),
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_tenant_db),
) -> InventoryMovementPage:
    """Return inventory movements for the signed-in shop."""
    return await list_inventory_movements(
        db,
        shop_id=shop.id,
        reference_date=reference_date,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        limit=limit,
    )


@router.get(
    "/inventory/transfers",
    response_model=InventoryTransferPage,
    response_model_exclude_unset=True,
    summary="List Shop Inventory Transfers",
)
async def shop_inventory_transfers(
    reference_date: date | None = Query(None),
    range_start_date: date | None = Query(None),
    range_end_date: date | None = Query(None),
    limit: int = Query(30, ge=1, le=100),
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_tenant_db),
) -> InventoryTransferPage:
    """Return inventory transfers out from the signed-in shop."""
    return await list_inventory_transfers(
        db,
        shop_id=shop.id,
        reference_date=reference_date,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        limit=limit,
    )


@router.get(
    "/inventory/retailer-usages",
    response_model=RetailerInventoryUsagePage,
    response_model_exclude_unset=True,
    summary="List Shop Retailer Inventory Usages",
)
async def shop_retailer_inventory_usages(
    reference_date: date | None = Query(None),
    range_start_date: date | None = Query(None),
    range_end_date: date | None = Query(None),
    limit: int = Query(30, ge=1, le=100),
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_tenant_db),
) -> RetailerInventoryUsagePage:
    """Return retailer-attributed inventory usage for the signed-in shop."""
    return await list_retailer_inventory_usages(
        db,
        shop_id=shop.id,
        reference_date=reference_date,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        limit=limit,
    )


@router.post(
    "/inventory/retailer-usages",
    response_model=RetailerInventoryUsageBulkResult,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Record Retailer Inventory Usages",
)
async def record_shop_retailer_inventory_usages(
    payload: RetailerInventoryUsageBulkCreate,
    shop: Shop = Depends(get_current_shop),
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
) -> RetailerInventoryUsageBulkResult:
    """Record retailer-attributed stock usage in bulk."""
    return await record_retailer_inventory_usages_bulk(
        db, shop, payload, actor=actor, include_summary=True
    )


@router.get(
    "/inventory/retailer-purchases",
    response_model=RetailerInventoryPurchasePage,
    response_model_exclude_unset=True,
    summary="List retailer inventory purchases",
)
async def shop_list_retailer_inventory_purchases(
    retailer_id: UUID | None = Query(None),
    reference_date: date | None = Query(None),
    range_start_date: date | None = Query(None),
    range_end_date: date | None = Query(None),
    limit: int = Query(30, ge=1, le=100),
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_tenant_db),
) -> RetailerInventoryPurchasePage:
    return await list_retailer_inventory_purchases(
        db,
        shop_id=shop.id,
        retailer_id=retailer_id,
        reference_date=reference_date,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        limit=limit,
    )


@router.post(
    "/inventory/retailer-purchases",
    response_model=RetailerInventoryPurchaseRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Record retailer inventory purchase",
)
async def shop_create_retailer_inventory_purchase(
    payload: RetailerInventoryPurchaseCreate,
    shop: Shop = Depends(get_current_shop),
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
) -> RetailerInventoryPurchaseRead:
    return await create_retailer_inventory_purchase(db, shop, payload, actor=actor)


@router.post(
    "/inventory/retailer-purchases/{purchase_id}/void",
    response_model=RetailerInventoryPurchaseRead,
    response_model_exclude_unset=True,
    summary="Void retailer inventory purchase",
)
async def shop_void_retailer_inventory_purchase(
    purchase_id: UUID,
    shop: Shop = Depends(get_current_shop),
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
) -> RetailerInventoryPurchaseRead:
    return await void_retailer_inventory_purchase(db, shop, purchase_id, actor=actor)


@router.get(
    "/expenses/items",
    response_model=ShopExpenseItemRowsPage,
    response_model_exclude_unset=True,
    summary="List Shop Expense Items",
)
async def shop_expense_items(
    q: str | None = Query(None, min_length=1, max_length=120),
    limit: int = Query(50, ge=1, le=100),
    cursor_sort_order: int | None = Query(None),
    cursor_name: str | None = Query(None, max_length=120),
    cursor_id: UUID | None = Query(None),
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_tenant_db),
) -> ShopExpenseItemRowsPage:
    """Return active expense items allocated to the signed-in shop."""
    return await list_current_shop_expense_items(
        db,
        shop,
        q=q,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.post(
    "/expenses/entries",
    response_model=ExpenseEntryRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Record Shop Expense",
)
async def record_shop_expense(
    payload: ExpenseEntryCreate,
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_tenant_db),
) -> ExpenseEntryRead:
    """Record a rupee expense against an admin-allocated expense item."""
    return await create_shop_expense_entry(db, shop, payload)


@router.get(
    "/expenses/history",
    response_model=ExpenseEntryPage,
    response_model_exclude_unset=True,
    summary="List Shop Expense History",
)
async def shop_expense_history(
    range_start_date: date | None = Query(None),
    range_end_date: date | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    cursor_spent_at: datetime | None = Query(None),
    cursor_id: UUID | None = Query(None),
    shop: Shop = Depends(get_current_shop),
    db: AsyncSession = Depends(get_tenant_db),
) -> ExpenseEntryPage:
    """Return paginated expense entries created by the signed-in shop."""
    return await list_expense_entries(
        db,
        shop_id=shop.id,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        limit=limit,
        cursor_spent_at=cursor_spent_at,
        cursor_id=cursor_id,
    )


@router.get(
    "/inventory/backdate-policy",
    response_model=InventoryBackdatePolicyRead,
    summary="Get Inventory Backdate Policy",
)
async def shop_inventory_backdate_policy(
    db: AsyncSession = Depends(get_tenant_db),
    _shop: Shop = Depends(get_current_shop),
) -> InventoryBackdatePolicyRead:
    """Return shop backdating rules for inventory transaction UI."""
    return await get_inventory_backdate_policy(db)


@router.post(
    "/inventory/items/{item_id}/add",
    response_model=InventoryMovementCreateResult,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Add Inventory Stock",
)
async def add_inventory_stock(
    item_id: UUID,
    payload: InventoryAddRequest,
    include_summary: bool = Query(
        False, description="Include the full inventory summary in the response."
    ),
    shop: Shop = Depends(get_current_shop),
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
) -> InventoryMovementCreateResult:
    """Add kg/unit stock to an allocated inventory item."""
    return await add_shop_inventory_stock(
        db, shop, item_id, payload, actor=actor, include_summary=include_summary
    )


@router.post(
    "/inventory/items/{item_id}/use",
    response_model=InventoryMovementCreateResult,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Use Inventory Stock",
)
async def use_inventory_stock(
    item_id: UUID,
    payload: InventoryUseRequest,
    include_summary: bool = Query(
        False, description="Include the full inventory summary in the response."
    ),
    shop: Shop = Depends(get_current_shop),
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
) -> InventoryMovementCreateResult:
    """Use kg/unit stock from an allocated inventory item by category."""
    return await use_shop_inventory_stock(
        db, shop, item_id, payload, actor=actor, include_summary=include_summary
    )


@router.post(
    "/inventory/items/{item_id}/use-split",
    response_model=InventoryMovementSplitCreateResult,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Use Inventory Stock Split By Category",
)
async def use_inventory_stock_split(
    item_id: UUID,
    payload: InventoryUseSplitRequest,
    include_summary: bool = Query(
        False, description="Include the full inventory summary in the response."
    ),
    shop: Shop = Depends(get_current_shop),
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
) -> InventoryMovementSplitCreateResult:
    """Use kg/unit stock from an allocated inventory item split across categories."""
    return await use_shop_inventory_stock_split(
        db,
        shop,
        item_id,
        payload,
        actor=actor,
        include_summary=include_summary,
    )


@router.post(
    "/inventory/items/{item_id}/transfer",
    response_model=InventoryTransferRead,
    status_code=201,
    summary="Transfer Inventory Stock",
)
async def transfer_inventory_stock(
    item_id: UUID,
    payload: InventoryTransferCreate,
    shop: Shop = Depends(get_current_shop),
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
) -> InventoryTransferRead:
    """Transfer kg/unit stock to a transfer shop destination."""
    return await create_inventory_transfer(
        db,
        source_shop=shop,
        inventory_item_id=item_id,
        payload=payload,
        user_id=shop.owner_user_id,
        actor=actor,
    )


@router.get(
    "/inventory/transfer-shops",
    response_model=list[TransferShopRead],
    summary="Get Active Transfer Shops",
)
async def list_active_transfer_shops(
    db: AsyncSession = Depends(get_tenant_db),
    _shop: Shop = Depends(get_current_shop),
) -> Sequence[TransferShopRead]:
    """Get active transfer shops for inventory transfers."""
    return await list_transfer_shops(db, active=True)


@router.post(
    "/bills/preview",
    response_model=BillCheckoutPreviewRead,
    status_code=200,
    response_model_exclude_unset=True,
    summary="Preview Bill",
)
async def preview_checkout(
    payload: BillCheckoutRequest,
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
) -> BillCheckoutPreviewRead:
    """Validate and build a printable bill without saving billing data."""
    return await preview_bill(db, shop, payload)


@router.post(
    "/bills",
    response_model=BillRead,
    response_model_exclude_unset=True,
    summary="Checkout Bill",
    responses={
        200: {"description": "Existing bill returned for idempotent retry"},
        201: {"description": "Bill created"},
    },
)
async def checkout(
    payload: BillCheckoutCommitRequest,
    response: Response,
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
    actor: User = Depends(get_current_user),
) -> BillRead:
    """Save a paid bill atomically; printing happens after commit on the client."""
    result = await create_bill(db, shop, payload, actor=actor)
    response.status_code = status.HTTP_201_CREATED if result.created else status.HTTP_200_OK
    return result.bill


@router.get(
    "/bills",
    response_model=ShopBillPage,
    response_model_exclude_unset=True,
    summary="List Shop Bills",
)
async def shop_list_bills(
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    bill_no: str | None = Query(None, max_length=50),
    range_start_date: date | None = Query(None),
    range_end_date: date | None = Query(None),
    payment_method: ShopBillPaymentMethodFilter | None = Query(None),
    payment_settled: bool | None = Query(None),
    receipt_status: ReceiptStatus | None = Query(None),
    created_by_user_id: UUID | None = Query(None),
    amount_min: Decimal | None = Query(None, ge=0),
    amount_max: Decimal | None = Query(None, ge=0),
    sort_by: ShopBillSortField = Query(ShopBillSortField.CREATED_AT),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
) -> ShopBillPage:
    return await list_shop_bills(
        db,
        shop,
        page=page,
        page_size=page_size,
        bill_no=bill_no,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        payment_method=payment_method,
        payment_settled=payment_settled,
        receipt_status=receipt_status,
        created_by_user_id=created_by_user_id,
        amount_min=amount_min,
        amount_max=amount_max,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


@router.get(
    "/bills/{bill_id}",
    response_model=BillRead,
    response_model_exclude_unset=True,
    summary="Get Shop Bill",
)
async def shop_get_bill(
    bill_id: UUID,
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
) -> BillRead:
    return await get_shop_bill(db, shop, bill_id)


@router.patch(
    "/bills/{bill_id}/receipt",
    response_model=BillRead,
    response_model_exclude_unset=True,
    summary="Update Bill Receipt Status",
)
async def shop_update_bill_receipt(
    bill_id: UUID,
    payload: BillReceiptStatusUpdate,
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
) -> BillRead:
    return await update_bill_receipt_status(db, shop, bill_id, payload)


@router.post(
    "/bills/{bill_id}/reprint",
    response_model=BillRead,
    response_model_exclude_unset=True,
    summary="Prepare Bill Reprint",
)
async def shop_reprint_bill(
    bill_id: UUID,
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
) -> BillRead:
    return await begin_bill_reprint(db, shop, bill_id)


@router.get(
    "/retailers",
    response_model=list[RetailerRead],
    summary="List active retailers",
)
async def shop_list_retailers(
    q: str | None = Query(None, max_length=120),
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
) -> list[RetailerRead]:
    return await list_active_retailers_for_shop(db, shop, q=q)


@router.get(
    "/retailers/{retailer_id}/wallet",
    response_model=RetailerWalletRead,
    summary="Retailer credit wallet balance",
)
async def shop_retailer_wallet(
    retailer_id: UUID,
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
) -> RetailerWalletRead:
    return await get_shop_retailer_wallet(db, shop, retailer_id)


@router.get(
    "/retailers/{retailer_id}/catalog",
    response_model=list[RetailerCatalogItemRead],
    summary="Retailer catalog for shop",
)
async def shop_retailer_catalog(
    retailer_id: UUID,
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
) -> list[RetailerCatalogItemRead]:
    return await get_retailer_catalog(db, shop, retailer_id)


@router.post(
    "/retailer-sales/preview",
    response_model=RetailerSalePreviewRead,
    summary="Preview retailer sale",
)
async def shop_preview_retailer_sale(
    payload: RetailerSaleCheckoutRequest,
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
    user: User = Depends(get_current_user),
) -> RetailerSalePreviewRead:
    return await preview_retailer_sale(db, shop, user, payload)


@router.post(
    "/retailer-sales",
    response_model=RetailerSaleRead,
    status_code=201,
    summary="Commit retailer sale",
)
async def shop_create_retailer_sale(
    payload: RetailerSaleCheckoutCommitRequest,
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
    user: User = Depends(get_current_user),
) -> RetailerSaleRead:
    return await create_retailer_sale(db, shop, user, payload)


# ponytail: rate-limit deferred — no shared payment rate-limit middleware yet
@router.post(
    "/retailer-sales/{sale_id}/payments",
    response_model=RetailerPaymentRecordResponse,
    summary="Record retailer payment",
)
async def shop_record_retailer_payment(
    sale_id: UUID,
    payload: RetailerPaymentCreate,
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
    user: User = Depends(get_current_user),
) -> RetailerPaymentRecordResponse:
    return await record_retailer_payment(db, shop, user, sale_id, payload)


@router.get(
    "/retailer-sales",
    response_model=RetailerSalePage,
    summary="List shop retailer sales",
)
async def shop_list_retailer_sales(
    retailer_id: UUID | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
) -> RetailerSalePage:
    return await list_retailer_sales(
        db, shop_id=shop.id, retailer_id=retailer_id, page=page, page_size=page_size
    )


@router.get(
    "/retailer-sales/{sale_id}",
    response_model=RetailerSaleRead,
    summary="Get retailer sale",
)
async def shop_get_retailer_sale(
    sale_id: UUID,
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
) -> RetailerSaleRead:
    return await get_retailer_sale(db, sale_id, shop_id=shop.id)


@router.get(
    "/retailer-sales/{sale_id}/receipts",
    response_model=RetailerSaleReceiptPage,
    summary="List retailer sale receipts",
)
async def shop_list_retailer_sale_receipts(
    sale_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
) -> RetailerSaleReceiptPage:
    return await list_retailer_sale_receipts(
        db, sale_id, shop_id=shop.id, page=page, page_size=page_size
    )


@router.get(
    "/retailer-sales/{sale_id}/receipts/{receipt_id}",
    response_model=RetailerSaleReceiptRead,
    summary="Get retailer sale receipt",
)
async def shop_get_retailer_sale_receipt(
    sale_id: UUID,
    receipt_id: UUID,
    db: AsyncSession = Depends(get_tenant_db),
    shop: Shop = Depends(get_current_shop),
) -> RetailerSaleReceiptRead:
    return await get_retailer_sale_receipt(db, sale_id, receipt_id, shop_id=shop.id)
