from app.routers.admin._common import *
from app.routers.admin._params import *

router = APIRouter()


@router.get(
    "/inventory/categories",
    response_model=list[InventoryCategoryRead],
    response_model_exclude_unset=True,
    summary="List Inventory Categories",
)
async def get_inventory_categories(db: DBSession) -> list[InventoryCategoryRead]:
    return await list_inventory_categories(db)


@router.post(
    "/inventory/categories",
    response_model=InventoryCategoryRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Create Inventory Category",
)
async def create_admin_inventory_category(
    payload: InventoryCategoryCreate,
    db: DBSession,
) -> InventoryCategoryRead:
    return await create_inventory_category(db, payload)


@router.patch(
    "/inventory/categories/{category_id}",
    response_model=InventoryCategoryRead,
    response_model_exclude_unset=True,
    summary="Update Inventory Category",
)
async def update_admin_inventory_category(
    category_id: UUID,
    payload: InventoryCategoryUpdate,
    db: DBSession,
) -> InventoryCategoryRead:
    return await update_inventory_category(db, category_id, payload)


@router.delete(
    "/inventory/categories/{category_id}",
    status_code=204,
    summary="Delete Inventory Category",
)
async def delete_admin_inventory_category(category_id: UUID, db: DBSession) -> Response:
    await delete_inventory_category(db, category_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/inventory/items/rows",
    response_model=InventoryItemRowsPage,
    response_model_exclude_unset=True,
    summary="List Inventory Item Rows",
)
async def get_inventory_item_rows(
    db: DBSession,
    q: ItemSearchParam = None,
    active: ItemActiveParam = None,
    limit: ItemsLimitParam = 100,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> InventoryItemRowsPage:
    return await list_inventory_item_rows(
        db,
        q=q,
        active=active,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/inventory/items/counts",
    response_model=InventoryItemCounts,
    response_model_exclude_unset=True,
    summary="Count Inventory Items",
)
async def get_inventory_item_counts(
    db: DBSession,
    q: ItemSearchParam = None,
    active: ItemActiveParam = None,
) -> InventoryItemCounts:
    return await count_inventory_items(db, q=q, active=active)


@router.get(
    "/inventory/items/{item_id}",
    response_model=InventoryItemRead,
    response_model_exclude_unset=True,
    summary="Get Inventory Item",
)
async def get_admin_inventory_item(item_id: UUID, db: DBSession) -> InventoryItemRead:
    return await get_inventory_item(db, item_id)


@router.post(
    "/inventory/items",
    response_model=InventoryItemRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Create Inventory Item",
)
async def create_admin_inventory_management_item(
    name: Annotated[str, Form(min_length=2, max_length=120)],
    unit_type: Annotated[UnitType, Form()],
    base_unit: Annotated[BaseUnit, Form()],
    tamil_name: Annotated[str, Form(min_length=1, max_length=120)],
    db: DBSession,
    is_active: Annotated[bool, Form()] = True,
    sort_order: Annotated[int, Form()] = 0,
    category_ids: Annotated[str, Form()] = "[]",
    billing_item_ids: Annotated[str, Form()] = "[]",
    billing_mappings: Annotated[str, Form()] = "[]",
    image: ItemImageUploadOptional = None,
) -> InventoryItemRead:
    payload = InventoryItemCreate(
        name=name,
        tamil_name=tamil_name,
        unit_type=unit_type,
        base_unit=base_unit,
        is_active=is_active,
        sort_order=sort_order,
        category_ids=_parse_inventory_category_ids(category_ids),
        billing_item_ids=_parse_inventory_billing_item_ids(billing_item_ids),
        billing_mappings=_parse_inventory_billing_mappings(billing_mappings),
    )
    return await create_inventory_management_item(db, payload, image=image)


@router.post(
    "/inventory/items/metadata",
    response_model=InventoryItemRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Create Inventory Item Metadata",
)
async def create_admin_inventory_item_metadata(
    payload: InventoryItemCreate,
    db: DBSession,
) -> InventoryItemRead:
    return await create_inventory_management_item(db, payload)


@router.patch(
    "/inventory/items/{item_id}",
    response_model=InventoryItemRead,
    response_model_exclude_unset=True,
    summary="Update Inventory Item",
)
async def update_admin_inventory_management_item(
    item_id: UUID,
    name: Annotated[str, Form(min_length=2, max_length=120)],
    unit_type: Annotated[UnitType, Form()],
    base_unit: Annotated[BaseUnit, Form()],
    tamil_name: Annotated[str, Form(min_length=1, max_length=120)],
    db: DBSession,
    is_active: Annotated[bool, Form()] = True,
    sort_order: Annotated[int, Form()] = 0,
    category_ids: Annotated[str, Form()] = "[]",
    billing_item_ids: Annotated[str, Form()] = "[]",
    billing_mappings: Annotated[str, Form()] = "[]",
    remove_image: Annotated[bool, Form()] = False,
    image: ItemImageUploadOptional = None,
) -> InventoryItemRead:
    payload = InventoryItemUpdate(
        name=name,
        tamil_name=tamil_name,
        unit_type=unit_type,
        base_unit=base_unit,
        is_active=is_active,
        sort_order=sort_order,
        category_ids=_parse_inventory_category_ids(category_ids),
        billing_item_ids=_parse_inventory_billing_item_ids(billing_item_ids),
        billing_mappings=_parse_inventory_billing_mappings(billing_mappings),
    )
    return await update_inventory_management_item(
        db,
        item_id,
        payload,
        image=image,
        remove_image=remove_image,
    )


@router.patch(
    "/inventory/items/{item_id}/metadata",
    response_model=InventoryItemRead,
    response_model_exclude_unset=True,
    summary="Update Inventory Item Metadata",
)
async def patch_admin_inventory_item_metadata(
    item_id: UUID,
    payload: InventoryItemUpdate,
    db: DBSession,
) -> InventoryItemRead:
    return await update_inventory_management_item(db, item_id, payload)


@router.patch(
    "/inventory/items/{item_id}/purchase-rate",
    response_model=InventoryItemRead,
    response_model_exclude_unset=True,
    summary="Update Inventory Item Purchase Rate",
)
async def patch_admin_inventory_item_purchase_rate(
    item_id: UUID,
    payload: InventoryItemPurchaseRateUpdate,
    db: DBSession,
) -> InventoryItemRead:
    return await update_inventory_item_purchase_rate(db, item_id, payload)


@router.post(
    "/inventory/items/purchase-rates/confirm-today",
    response_model=InventoryPurchaseRatesConfirmRead,
    summary="Confirm Today's Inventory Purchase Rates",
)
async def confirm_admin_inventory_purchase_rates_today(
    db: DBSession,
) -> InventoryPurchaseRatesConfirmRead:
    updated_count = await confirm_inventory_purchase_rates_today(db)
    return InventoryPurchaseRatesConfirmRead(updated_count=updated_count)


@router.get(
    "/inventory/items/purchase-rates/history",
    response_model=list[InventoryItemPurchaseRateHistoryRead],
    summary="Get Inventory Purchase Rates History",
)
async def get_admin_inventory_purchase_rates_history(
    reference_date: date,
    db: DBSession,
) -> list[InventoryItemPurchaseRateHistoryRead]:
    rates = await get_inventory_purchase_rates_history(db, reference_date)
    return [
        InventoryItemPurchaseRateHistoryRead(inventory_item_id=item_id, purchase_rate=rate)
        for item_id, rate in rates.items()
    ]


@router.put(
    "/inventory/items/{item_id}/image",
    response_model=InventoryItemImageRead,
    response_model_exclude_unset=True,
    summary="Replace Inventory Item Image",
)
async def upload_admin_inventory_item_image(
    item_id: UUID,
    image: ItemImageUploadRequired,
    db: DBSession,
) -> InventoryItemImageRead:
    return await upload_inventory_item_image_service(db, item_id, image)


@router.delete(
    "/inventory/items/{item_id}/image",
    response_model=InventoryItemImageRead,
    response_model_exclude_unset=True,
    summary="Remove Inventory Item Image",
)
async def delete_admin_inventory_item_image(
    item_id: UUID,
    db: DBSession,
) -> InventoryItemImageRead:
    return await remove_inventory_item_image_service(db, item_id)


@router.delete(
    "/inventory/items/{item_id}",
    status_code=204,
    summary="Delete Inventory Item",
)
async def delete_admin_inventory_management_item(item_id: UUID, db: DBSession) -> Response:
    await delete_inventory_management_item(db, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/shops/{shop_id}/inventory-allocations/rows",
    response_model=InventoryStockRowsPage,
    response_model_exclude_unset=True,
    summary="List Shop Inventory Allocation Rows",
)
async def get_shop_inventory_allocation_rows(
    shop: ShopDep,
    db: DBSession,
    q: str | None = Query(None, min_length=1, max_length=120),
    active: bool | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    cursor_sort_order: int | None = Query(None),
    cursor_name: str | None = Query(None, max_length=120),
    cursor_id: UUID | None = Query(None),
) -> InventoryStockRowsPage:
    return await list_inventory_stock_rows(
        db,
        shop,
        q=q,
        active=active,
        include_unallocated=True,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/shops/{shop_id}/inventory-allocations",
    response_model=InventorySummaryRead,
    response_model_exclude_unset=True,
    summary="List Shop Inventory Allocations",
)
async def get_shop_inventory_allocations(shop: ShopDep, db: DBSession) -> InventorySummaryRead:
    return await get_inventory_summary(db, shop, include_unallocated=True)


@router.post(
    "/shops/{shop_id}/inventory-allocations",
    response_model=ShopInventoryAllocationBulkRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Allocate Inventory Items",
)
async def allocate_shop_inventory(
    payload: ShopInventoryAllocationBulkCreate,
    shop: ShopDep,
    db: DBSession,
) -> ShopInventoryAllocationBulkRead:
    return await allocate_shop_inventory_items(db, shop, payload.item_ids)


@router.patch(
    "/shops/{shop_id}/inventory-allocations",
    response_model=InventoryItemStockRead | InventorySummaryRead,
    response_model_exclude_unset=True,
    summary="Update Shop Inventory Allocation",
)
async def update_shop_inventory(
    payload: ShopInventoryAllocationUpdate,
    shop: ShopDep,
    db: DBSession,
    include_summary: bool = Query(
        False, description="Include the full inventory summary in the response."
    ),
) -> InventoryItemStockRead | InventorySummaryRead:
    stock_item = await update_shop_inventory_allocation(
        db,
        shop,
        payload.item_id,
        is_active=payload.is_active,
        sort_order=payload.sort_order,
    )
    if include_summary:
        return await get_inventory_summary(db, shop, include_unallocated=True)
    return stock_item


@router.patch(
    "/shops/{shop_id}/inventory-allocations/{item_id}/stock",
    response_model=InventoryItemStockRead,
    response_model_exclude_unset=True,
    summary="Adjust Shop Inventory Stock",
)
async def adjust_shop_inventory_stock(
    item_id: UUID,
    payload: InventoryStockAdjustRequest,
    shop: ShopDep,
    actor: Annotated[User, Depends(get_current_user)],
    db: DBSession,
) -> InventoryItemStockRead:
    return await admin_set_shop_inventory_stock(db, shop, item_id, payload, actor=actor)


@router.get(
    "/inventory/summary",
    response_model=InventorySummaryRead,
    response_model_exclude_unset=True,
    summary="Get Inventory Summary",
)
async def get_admin_inventory_summary(
    db: DBSession,
    shop: ShopDep,
) -> InventorySummaryRead:
    return await get_inventory_summary(db, shop, include_unallocated=False)


@router.get(
    "/inventory/movements",
    response_model=InventoryMovementPage,
    response_model_exclude_unset=True,
    summary="List Inventory Movements",
)
async def get_admin_inventory_movements(
    db: DBSession,
    shop_id: ShopIdParam = None,
    item_id: ItemCursorIdParam = None,
    category_id: ItemCategoryIdParam = None,
    reference_date: ReferenceDateParam = None,
    range_start_date: RangeStartDateParam = None,
    range_end_date: RangeEndDateParam = None,
    limit: ItemsLimitParam = 100,
) -> InventoryMovementPage:
    return await list_inventory_movements(
        db,
        shop_id=shop_id,
        item_id=item_id,
        category_id=category_id,
        reference_date=reference_date,
        range_start_date=range_start_date,
        range_end_date=range_end_date,
        limit=limit,
    )


@router.get(
    "/inventory/backdate-policy",
    response_model=InventoryBackdatePolicyRead,
    summary="Get Inventory Backdate Policy",
)
async def get_admin_inventory_backdate_policy(db: DBSession) -> InventoryBackdatePolicyRead:
    return await get_inventory_backdate_policy(db)


@router.put(
    "/inventory/backdate-policy",
    response_model=InventoryBackdatePolicyRead,
    summary="Update Inventory Backdate Policy",
)
async def put_admin_inventory_backdate_policy(
    payload: InventoryBackdatePolicyUpdate,
    db: DBSession,
) -> InventoryBackdatePolicyRead:
    return await update_inventory_backdate_policy(db, payload)


@router.post(
    "/shops/{shop_id}/inventory/items/{item_id}/add",
    response_model=InventoryMovementCreateResult,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Admin Add Inventory Stock",
)
async def admin_add_inventory_stock(
    item_id: UUID,
    payload: InventoryAddRequest,
    shop: ShopDep,
    actor: Annotated[User, Depends(get_current_user)],
    db: DBSession,
    include_summary: bool = Query(False),
) -> InventoryMovementCreateResult:
    return await add_shop_inventory_stock(
        db, shop, item_id, payload, actor=actor, include_summary=include_summary
    )


@router.post(
    "/shops/{shop_id}/inventory/items/{item_id}/use",
    response_model=InventoryMovementCreateResult,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Admin Use Inventory Stock",
)
async def admin_use_inventory_stock(
    item_id: UUID,
    payload: InventoryUseRequest,
    shop: ShopDep,
    actor: Annotated[User, Depends(get_current_user)],
    db: DBSession,
    include_summary: bool = Query(False),
) -> InventoryMovementCreateResult:
    return await use_shop_inventory_stock(
        db, shop, item_id, payload, actor=actor, include_summary=include_summary
    )


@router.post(
    "/shops/{shop_id}/inventory/items/{item_id}/use-split",
    response_model=InventoryMovementSplitCreateResult,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Admin Use Inventory Stock Split",
)
async def admin_use_inventory_stock_split(
    item_id: UUID,
    payload: InventoryUseSplitRequest,
    shop: ShopDep,
    actor: Annotated[User, Depends(get_current_user)],
    db: DBSession,
    include_summary: bool = Query(False),
) -> InventoryMovementSplitCreateResult:
    return await use_shop_inventory_stock_split(
        db, shop, item_id, payload, actor=actor, include_summary=include_summary
    )


@router.post(
    "/shops/{shop_id}/inventory/items/{item_id}/transfer",
    response_model=InventoryTransferRead,
    status_code=201,
    summary="Admin Transfer Inventory Stock",
)
async def admin_transfer_inventory_stock(
    item_id: UUID,
    payload: InventoryTransferCreate,
    shop: ShopDep,
    actor: Annotated[User, Depends(get_current_user)],
    db: DBSession,
) -> InventoryTransferRead:
    return await create_inventory_transfer(
        db,
        source_shop=shop,
        inventory_item_id=item_id,
        payload=payload,
        user_id=actor.id,
        actor=actor,
    )
