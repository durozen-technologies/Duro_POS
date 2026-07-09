"""Shared imports for admin route modules."""

import json
from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_roles
from app.core.deps import get_current_admin, get_tenant_shop_or_404
from app.db.storage import upload_item_image
from app.models import BaseUnit, Shop, UnitType, User, UserRole
from app.schemas.admin import (
    AdminBillPage,
    AdminDashboardBootstrap,
    AdminItemRowsPage,
    AdminReportDetailLevel,
    AdminReportSection,
    AnalyticsPeriod,
    ConfirmDeleteRequest,
    ItemAssumptionUpdate,
    ItemCategoryCreate,
    ItemCategoryRead,
    ItemCategoryUpdate,
    ItemCreate,
    ItemMetadataUpdate,
    ItemRead,
    ItemSalesSummary,
    ItemScope,
    ItemUpdate,
    OverallReportRead,
    PaymentSplitSummary,
    PriceStatus,
    ShopCreate,
    ShopItemAllocationBulkCreate,
    ShopItemAllocationBulkRead,
    ShopItemAllocationUpdate,
    ShopItemCounts,
    ShopItemPage,
    ShopItemRead,
    ShopRead,
    ShopSalesSummary,
    ShopSelectedItemsOrderRead,
    ShopSelectedItemsOrderUpdate,
    ShopStatusUpdate,
    ShopUpdate,
)
from app.services.admin._credentials import verify_tenant_admin_credentials
from app.schemas.billing import BillDetailBatchRequest, BillRead
from app.schemas.expenses import (
    ExpenseEntryPage,
    ExpenseEntryRead,
    ExpenseEntryUpdate,
    ExpenseItemCounts,
    ExpenseItemCreate,
    ExpenseItemRead,
    ExpenseItemRowsPage,
    ExpenseItemUpdate,
    ShopExpenseAllocationBulkCreate,
    ShopExpenseAllocationBulkRead,
    ShopExpenseAllocationUpdate,
    ShopExpenseItemRead,
    ShopExpenseItemRowsPage,
    ShopExpenseItemsOrderRead,
    ShopExpenseItemsOrderUpdate,
)
from app.schemas.inventory import (
    InventoryAddRequest,
    InventoryBillingItemMappingWrite,
    InventoryCategoryCreate,
    InventoryCategoryRead,
    InventoryCategoryUpdate,
    InventoryItemCounts,
    InventoryItemCreate,
    InventoryItemImageRead,
    InventoryItemPurchaseRateHistoryRead,
    InventoryItemPurchaseRateUpdate,
    InventoryItemRead,
    InventoryItemRowsPage,
    InventoryItemStockRead,
    InventoryItemUpdate,
    InventoryMovementCreateResult,
    InventoryMovementPage,
    InventoryMovementSplitCreateResult,
    InventoryPurchaseRatesConfirmRead,
    InventoryStockAdjustRequest,
    InventoryStockRowsPage,
    InventorySummaryRead,
    InventoryUseRequest,
    InventoryUseSplitRequest,
    ShopInventoryAllocationBulkCreate,
    ShopInventoryAllocationBulkRead,
    ShopInventoryAllocationUpdate,
)
from app.schemas.inventory_policy import InventoryBackdatePolicyRead, InventoryBackdatePolicyUpdate
from app.schemas.retailer_inventory import (
    RetailerInventoryUsagePage,
    RetailerStockAdjustRequest,
)
from app.schemas.pricing import (
    DailyPriceCreate,
    DailyPriceRead,
    DailyPriceUpdate,
    ItemImageRead,
    ShopBootstrapResponse,
)
from app.schemas.transfer import (
    InventoryTransferCreate,
    InventoryTransferPage,
    InventoryTransferRead,
    TransferShopCreate,
    TransferShopRead,
    TransferShopUpdate,
)
from app.services.admin import (
    allocate_catalogue_item,
    allocate_catalogue_items,
    count_catalogue_items,
    count_selected_shop_items,
    count_shop_item_import_candidates,
    create_item,
    create_item_category,
    create_shop_account,
    deallocate_catalogue_item,
    delete_item,
    delete_item_category,
    delete_shop_account,
    get_bill_by_id,
    get_bills_by_ids,
    get_catalogue_item,
    get_daily_bills,
    get_dashboard_bootstrap,
    get_item_sales_summary,
    get_payment_split_summary,
    get_shop_by_id,
    get_shop_item,
    get_shop_sales_summary,
    list_catalogue_item_rows,
    list_catalogue_items,
    list_item_categories,
    list_selected_shop_item_rows,
    list_selected_shop_items,
    list_shop_item_import_candidate_rows,
    list_shop_item_import_candidates,
    list_shop_items,
    list_shops,
    set_shop_active_state,
    update_catalogue_item_allocation,
    update_item,
    update_item_assumption,
    update_item_category,
    update_item_metadata,
    update_selected_shop_items_order,
    update_shop_account,
)
from app.services.expenses import (
    allocate_shop_expense_item,
    allocate_shop_expense_items,
    count_expense_items,
    create_expense_item,
    deallocate_shop_expense_item,
    delete_expense_item,
    get_expense_item,
    list_expense_entries,
    list_expense_item_rows,
    list_shop_expense_candidate_rows,
    list_shop_expense_item_rows,
    remove_expense_item_image,
    update_expense_entry,
    update_expense_item,
    update_shop_expense_allocation,
    update_shop_expense_items_order,
    upload_expense_item_image,
)
from app.services.inventory import (
    add_shop_inventory_stock,
    admin_set_shop_inventory_stock,
    allocate_shop_inventory_items,
    confirm_inventory_purchase_rates_today,
    count_inventory_items,
    create_inventory_category,
    delete_inventory_category,
    get_inventory_item,
    get_inventory_purchase_rates_history,
    get_inventory_summary,
    list_inventory_categories,
    list_inventory_item_rows,
    list_inventory_movements,
    list_inventory_stock_rows,
    update_inventory_category,
    update_inventory_item_purchase_rate,
    update_shop_inventory_allocation,
    use_shop_inventory_stock,
    use_shop_inventory_stock_split,
)
from app.services.inventory import (
    create_inventory_item as create_inventory_management_item,
)
from app.services.inventory import (
    delete_inventory_item as delete_inventory_management_item,
)
from app.services.inventory import (
    remove_inventory_item_image as remove_inventory_item_image_service,
)
from app.services.inventory import (
    update_inventory_item as update_inventory_management_item,
)
from app.services.inventory import (
    upload_inventory_item_image as upload_inventory_item_image_service,
)
from app.services.inventory_policy import (
    get_inventory_backdate_policy,
    update_inventory_backdate_policy,
)
from app.services.retailer_inventory import (
    admin_set_retailer_inventory_stock,
    list_retailer_inventory_usages,
)
from app.services.pricing import (
    create_daily_prices,
    create_global_daily_prices,
    create_partial_daily_prices,
    get_global_bootstrap,
    get_shop_bootstrap,
    get_shop_price_history,
    upsert_shop_daily_price,
)
from app.services.reports import (
    build_overall_report,
    generate_admin_report_pdf,
    iter_admin_report_file,
)
from app.services.storage import delete_item_image
from app.services.transfer import (
    create_inventory_transfer,
    create_transfer_shop,
    list_inventory_transfers,
    list_transfer_shops,
    update_transfer_shop,
)


def _require_org_id(user: User) -> UUID:
    if user.organization_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant admin is not linked to an organization",
        )
    return user.organization_id
