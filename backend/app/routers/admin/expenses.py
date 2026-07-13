from app.routers.admin._common import *
from app.routers.admin._params import *

router = APIRouter()


@router.get(
    "/expenses/items",
    response_model=ExpenseItemRowsPage,
    response_model_exclude_unset=True,
    summary="List Expense Items",
)
async def get_expense_items(
    db: DBSession,
    q: ItemSearchParam = None,
    active: ItemActiveParam = None,
    limit: ItemsLimitParam = 50,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> ExpenseItemRowsPage:
    return await list_expense_item_rows(
        db,
        q=q,
        active=active,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/expenses/items/counts",
    response_model=ExpenseItemCounts,
    response_model_exclude_unset=True,
    summary="Count Expense Items",
)
async def get_expense_item_counts(
    db: DBSession,
    q: ItemSearchParam = None,
) -> ExpenseItemCounts:
    return await count_expense_items(db, q=q)


@router.post(
    "/expenses/items",
    response_model=ExpenseItemRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Create Expense Item",
)
async def create_admin_expense_item(
    payload: ExpenseItemCreate,
    db: DBSession,
    platform_db: PlatformDB,
) -> ExpenseItemRead:
    return await create_expense_item(db, payload, platform_db=platform_db)


@router.get(
    "/expenses/items/{expense_item_id}",
    response_model=ExpenseItemRead,
    response_model_exclude_unset=True,
    summary="Get Expense Item",
)
async def get_admin_expense_item(expense_item_id: UUID, db: DBSession) -> ExpenseItemRead:
    return await get_expense_item(db, expense_item_id)


@router.patch(
    "/expenses/items/{expense_item_id}",
    response_model=ExpenseItemRead,
    response_model_exclude_unset=True,
    summary="Update Expense Item",
)
async def update_admin_expense_item(
    expense_item_id: UUID,
    payload: ExpenseItemUpdate,
    db: DBSession,
    platform_db: PlatformDB,
) -> ExpenseItemRead:
    return await update_expense_item(db, expense_item_id, payload, platform_db=platform_db)


@router.delete(
    "/expenses/items/{expense_item_id}",
    status_code=204,
    summary="Delete Expense Item",
)
async def delete_admin_expense_item(expense_item_id: UUID, db: DBSession) -> Response:
    await delete_expense_item(db, expense_item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/expenses/items/{expense_item_id}/image",
    response_model=ExpenseItemRead,
    response_model_exclude_unset=True,
    summary="Upload Expense Item Image",
)
async def upload_admin_expense_item_image(
    expense_item_id: UUID,
    db: DBSession,
    image: ItemImageUploadRequired,
) -> ExpenseItemRead:
    return await upload_expense_item_image(db, expense_item_id, image)


@router.delete(
    "/expenses/items/{expense_item_id}/image",
    response_model=ExpenseItemRead,
    response_model_exclude_unset=True,
    summary="Delete Expense Item Image",
)
async def delete_admin_expense_item_image(expense_item_id: UUID, db: DBSession) -> ExpenseItemRead:
    return await remove_expense_item_image(db, expense_item_id)


@router.get(
    "/shops/{shop_id}/expense-items",
    response_model=ShopExpenseItemRowsPage,
    response_model_exclude_unset=True,
    summary="List Branch Expense Items",
)
async def get_shop_expense_items(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    active: ItemActiveParam = None,
    limit: ItemsLimitParam = 50,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> ShopExpenseItemRowsPage:
    return await list_shop_expense_item_rows(
        db,
        shop,
        q=q,
        active=active,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/shops/{shop_id}/expense-items/counts",
    response_model=ExpenseItemCounts,
    response_model_exclude_unset=True,
    summary="Count Branch Expense Items",
)
async def get_shop_expense_item_counts(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
) -> ExpenseItemCounts:
    return await count_expense_items(db, shop_id=shop.id, q=q)


@router.get(
    "/shops/{shop_id}/expense-item-candidates",
    response_model=ExpenseItemRowsPage,
    response_model_exclude_unset=True,
    summary="List Branch Expense Item Candidates",
)
async def get_shop_expense_item_candidates(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    limit: ItemsLimitParam = 50,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> ExpenseItemRowsPage:
    return await list_shop_expense_candidate_rows(
        db,
        shop,
        q=q,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.post(
    "/shops/{shop_id}/expense-items/allocations",
    response_model=ShopExpenseAllocationBulkRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Allocate Branch Expense Items",
)
async def allocate_shop_expenses(
    payload: ShopExpenseAllocationBulkCreate,
    shop: ShopDep,
    db: DBSession,
) -> ShopExpenseAllocationBulkRead:
    return await allocate_shop_expense_items(db, shop, payload.expense_item_ids)


@router.post(
    "/shops/{shop_id}/expense-items/{expense_item_id}/allocation",
    response_model=ShopExpenseItemRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Allocate Branch Expense Item",
)
async def allocate_shop_expense(
    expense_item_id: UUID,
    shop: ShopDep,
    db: DBSession,
) -> ShopExpenseItemRead:
    return await allocate_shop_expense_item(db, shop, expense_item_id)


@router.patch(
    "/shops/{shop_id}/expense-items/{expense_item_id}/allocation",
    response_model=ShopExpenseItemRead,
    response_model_exclude_unset=True,
    summary="Update Branch Expense Allocation",
)
async def update_shop_expense(
    expense_item_id: UUID,
    payload: ShopExpenseAllocationUpdate,
    shop: ShopDep,
    db: DBSession,
) -> ShopExpenseItemRead:
    return await update_shop_expense_allocation(db, shop, expense_item_id, payload)


@router.delete(
    "/shops/{shop_id}/expense-items/{expense_item_id}/allocation",
    response_model=ShopExpenseItemRead,
    response_model_exclude_unset=True,
    summary="Remove Branch Expense Allocation",
)
async def deallocate_shop_expense(
    expense_item_id: UUID,
    shop: ShopDep,
    db: DBSession,
) -> ShopExpenseItemRead:
    return await deallocate_shop_expense_item(db, shop, expense_item_id)


@router.put(
    "/shops/{shop_id}/expense-items/order",
    response_model=ShopExpenseItemsOrderRead,
    response_model_exclude_unset=True,
    summary="Update Branch Expense Item Order",
)
async def update_shop_expense_order(
    payload: ShopExpenseItemsOrderUpdate,
    shop: ShopDep,
    db: DBSession,
) -> ShopExpenseItemsOrderRead:
    return await update_shop_expense_items_order(db, shop, payload.expense_item_ids)


@router.patch(
    "/expenses/history/{entry_id}",
    response_model=ExpenseEntryRead,
    response_model_exclude_unset=True,
    summary="Update Expense History Entry",
)
async def update_admin_expense_entry(
    entry_id: UUID,
    payload: ExpenseEntryUpdate,
    db: DBSession,
) -> ExpenseEntryRead:
    return await update_expense_entry(db, entry_id, payload)


@router.get(
    "/expenses/history",
    response_model=ExpenseEntryPage,
    response_model_exclude_unset=True,
    summary="List Expense History",
)
async def get_expense_history(
    db: DBSession,
    shop_id: ShopIdParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    limit: ItemsLimitParam = 50,
    cursor_spent_at: CursorSpentAtParam = None,
    cursor_id: CursorIdParam = None,
) -> ExpenseEntryPage:
    return await list_expense_entries(
        db,
        shop_id=shop_id,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        limit=limit,
        cursor_spent_at=cursor_spent_at,
        cursor_id=cursor_id,
    )
