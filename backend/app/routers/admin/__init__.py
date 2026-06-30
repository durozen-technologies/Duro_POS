"""Admin API routes — domain sub-routers mounted under /admin."""

from fastapi import APIRouter, Depends

from app.auth.dependencies import require_tenant_admin
from app.models import UserRole
from app.routers.admin import (
    analytics,
    billing,
    catalogue,
    dashboard,
    expenses,
    inventory,
    pricing,
    shops,
    transfers,
)

router = APIRouter(tags=["Admin"], dependencies=[Depends(require_tenant_admin())])

for module in (
    shops,
    catalogue,
    inventory,
    expenses,
    analytics,
    billing,
    pricing,
    dashboard,
    transfers,
):
    router.include_router(module.router)

# Re-export handlers for integration tests and backward compatibility.
from app.routers.admin.analytics import (  # noqa: E402, F401
    admin_overall_report,
    admin_report_pdf,
    item_sales,
    payment_summary,
    sales_summary,
)
from app.routers.admin.billing import bill_detail, bill_details, bills  # noqa: E402, F401
from app.routers.admin.catalogue import (  # noqa: E402, F401
    allocate_shop_catalogue_item,
    allocate_shop_catalogue_items,
    create_admin_item_category,
    create_inventory_item,
    create_shop_inventory_item,
    deallocate_shop_catalogue_item,
    delete_admin_item_category,
    delete_inventory_item,
    delete_inventory_item_image,
    delete_shop_inventory_item,
    get_catalogue_item_counts,
    get_catalogue_item_detail,
    get_catalogue_item_rows,
    get_catalogue_items,
    get_item_categories,
    get_selected_shop_item_counts,
    get_selected_shop_item_rows,
    get_selected_shop_items,
    get_shop_item_detail,
    get_shop_item_import_candidate_counts,
    get_shop_item_import_candidate_rows,
    get_shop_item_import_candidates,
    get_shop_items,
    patch_inventory_item_assumption,
    patch_inventory_item_metadata,
    patch_shop_inventory_item_metadata,
    update_admin_item_category,
    update_inventory_item,
    update_selected_shop_items_display_order,
    update_shop_catalogue_item_allocation,
    update_shop_inventory_item,
    upload_inventory_item_image,
)
from app.routers.admin.dashboard import dashboard_bootstrap  # noqa: E402, F401
from app.routers.admin.expenses import (  # noqa: E402, F401
    allocate_shop_expense,
    allocate_shop_expenses,
    create_admin_expense_item,
    deallocate_shop_expense,
    delete_admin_expense_item,
    delete_admin_expense_item_image,
    get_expense_history,
    get_expense_item_counts,
    get_expense_items,
    get_shop_expense_item_candidates,
    get_shop_expense_items,
    update_admin_expense_entry,
    update_admin_expense_item,
    update_shop_expense,
    update_shop_expense_order,
    upload_admin_expense_item_image,
)
from app.routers.admin.inventory import (  # noqa: E402, F401
    adjust_shop_inventory_stock,
    allocate_shop_inventory,
    confirm_admin_inventory_purchase_rates_today,
    create_admin_inventory_category,
    create_admin_inventory_item_metadata,
    create_admin_inventory_management_item,
    delete_admin_inventory_category,
    delete_admin_inventory_item_image,
    delete_admin_inventory_management_item,
    get_admin_inventory_item,
    get_admin_inventory_movements,
    get_admin_inventory_purchase_rates_history,
    get_admin_inventory_summary,
    get_inventory_categories,
    get_inventory_item_counts,
    get_inventory_item_rows,
    get_shop_inventory_allocation_rows,
    get_shop_inventory_allocations,
    patch_admin_inventory_item_metadata,
    patch_admin_inventory_item_purchase_rate,
    update_admin_inventory_category,
    update_admin_inventory_management_item,
    update_shop_inventory,
    upload_admin_inventory_item_image,
)
from app.routers.admin.pricing import (  # noqa: E402, F401
    global_daily_prices,
    global_prices_bootstrap,
    shop_daily_price,
    shop_daily_prices,
    shop_daily_prices_partial,
    shop_price_history,
    shop_prices_bootstrap,
)
from app.routers.admin.shops import (  # noqa: E402, F401
    create_shop,
    delete_shop,
    get_shop,
    get_shops,
    update_shop,
    update_shop_status,
)
from app.routers.admin.transfers import (  # noqa: E402, F401
    admin_create_transfer_shop,
    admin_list_inventory_transfers,
    admin_list_transfer_shops,
    admin_update_transfer_shop,
)
