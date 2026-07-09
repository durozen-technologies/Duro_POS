from app.routers.admin._common import *
from app.routers.admin._common import _require_org_id
from app.routers.admin._params import *

router = APIRouter()


@router.get(
    "/item-categories",
    response_model=list[ItemCategoryRead],
    response_model_exclude_unset=True,
    summary="List Item Categories",
)
async def get_item_categories(db: DBSession, current_user: AdminUserDep) -> list[ItemCategoryRead]:
    """Return global item categories for catalogue item forms and filters."""
    return await list_item_categories(db, _require_org_id(current_user))


@router.post(
    "/item-categories",
    response_model=ItemCategoryRead,
    response_model_exclude_unset=True,
    status_code=201,
    summary="Create Item Category",
)
async def create_admin_item_category(
    payload: ItemCategoryCreate,
    db: DBSession,
    current_user: AdminUserDep,
) -> ItemCategoryRead:
    """Create a reusable global item category."""
    return await create_item_category(db, payload, _require_org_id(current_user))


@router.patch(
    "/item-categories/{category_id}",
    response_model=ItemCategoryRead,
    response_model_exclude_unset=True,
    summary="Update Item Category",
)
async def update_admin_item_category(
    category_id: UUID,
    payload: ItemCategoryUpdate,
    db: DBSession,
    current_user: AdminUserDep,
) -> ItemCategoryRead:
    """Rename a category and refresh assigned item category labels."""
    org_id = _require_org_id(current_user)
    return await update_item_category(db, category_id, payload, organization_id=org_id)


@router.delete(
    "/item-categories/{category_id}",
    status_code=204,
    summary="Delete Item Category",
)
async def delete_admin_item_category(
    category_id: UUID, db: DBSession, current_user: AdminUserDep
) -> Response:
    """Delete a category and clear it from assigned catalogue items."""
    await delete_item_category(db, category_id, _require_org_id(current_user))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/shops/{shop_id}/items",
    response_model=ItemRead,
    status_code=201,
    summary="Create Shop Item",
    description=(
        "Create an item owned by this shop. Submit multipart form-data with item fields and "
        "an optional square 1:1 image. The item appears in this shop's price setup and billing."
    ),
)
async def create_shop_inventory_item(
    name: Annotated[
        str, Form(min_length=2, max_length=120, description="Display name of the item.")
    ],
    unit_type: Annotated[
        UnitType,
        Form(description="High-level quantity mode: `weight` or `count`."),
    ],
    base_unit: Annotated[
        BaseUnit,
        Form(description="Base billing unit used for prices and quantities: `kg` or `unit`."),
    ],
    tamil_name: Annotated[
        str,
        Form(min_length=1, max_length=120, description="Tamil display name of the item."),
    ],
    shop: ShopDep,
    db: DBSession,
    is_active: Annotated[
        bool,
        Form(
            description="Whether the item should be available for pricing and billing immediately."
        ),
    ] = True,
    custom_attributes: Annotated[
        str,
        Form(description="JSON object with admin-defined item attributes."),
    ] = "{}",
    sort_order: Annotated[int, Form(description="Display sort order for item lists.")] = 0,
    category: Annotated[
        str | None, Form(max_length=80, description="Optional display category.")
    ] = None,
    category_id: Annotated[
        UUID | None, Form(description="Optional reusable item category ID.")
    ] = None,
    image: ItemImageUploadOptional = None,
) -> ItemRead:
    payload = ItemCreate(
        name=name,
        tamil_name=tamil_name,
        unit_type=unit_type,
        base_unit=base_unit,
        is_active=is_active,
        sort_order=sort_order,
        category_id=category_id,
        category=category,
        custom_attributes=_parse_custom_attributes(custom_attributes),
    )
    return await create_item(db, payload, image=image, shop_id=shop.id)


@router.get(
    "/shops/{shop_id}/items",
    response_model=ShopItemPage,
    response_model_exclude_unset=True,
    summary="List Shop Items",
)
async def get_shop_items(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    scope: ItemScopeParam = None,
    allocated: ItemAllocatedParam = None,
    priced: ItemPricedParam = None,
    price_status: ItemPriceStatusParam = None,
    active: ItemActiveParam = None,
    limit: ItemsLimitParam = 500,
    cursor_group: ItemCursorGroupParam = None,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> ShopItemPage:
    """Return catalogue items plus this shop's own items with allocation state and prices."""
    return await list_shop_items(
        db,
        shop,
        q=q,
        scope=scope,
        allocated=allocated,
        priced=priced,
        price_status=price_status,
        active=active,
        limit=limit,
        cursor_group=cursor_group,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/shops/{shop_id}/selected-items",
    response_model=ShopItemPage,
    response_model_exclude_unset=True,
    summary="List Selected Shop Items",
)
async def get_selected_shop_items(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    limit: ItemsLimitParam = 100,
    category_id: ItemCategoryIdParam = None,
    uncategorized: ItemUncategorizedParam = None,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> ShopItemPage:
    """Return compact selected item rows for the shop item management page."""
    return await list_selected_shop_items(
        db,
        shop,
        q=q,
        limit=limit,
        category_id=category_id,
        uncategorized=uncategorized,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/shops/{shop_id}/selected-items/rows",
    response_model=AdminItemRowsPage,
    response_model_exclude_unset=True,
    summary="List Selected Shop Item Rows",
)
async def get_selected_shop_item_rows(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    limit: ItemsLimitParam = 100,
    category_id: ItemCategoryIdParam = None,
    uncategorized: ItemUncategorizedParam = None,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> AdminItemRowsPage:
    """Return row-first selected shop item data without count-heavy joins."""
    return await list_selected_shop_item_rows(
        db,
        shop,
        q=q,
        limit=limit,
        category_id=category_id,
        uncategorized=uncategorized,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/shops/{shop_id}/selected-items/counts",
    response_model=ShopItemCounts,
    response_model_exclude_unset=True,
    summary="Count Selected Shop Items",
)
async def get_selected_shop_item_counts(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    category_id: ItemCategoryIdParam = None,
    uncategorized: ItemUncategorizedParam = None,
) -> ShopItemCounts:
    """Return exact selected shop item counts for background UI badges."""
    return await count_selected_shop_items(
        db,
        shop,
        q=q,
        category_id=category_id,
        uncategorized=uncategorized,
    )


@router.put(
    "/shops/{shop_id}/selected-items/order",
    response_model=ShopSelectedItemsOrderRead,
    response_model_exclude_unset=True,
    summary="Update Selected Shop Item Order",
)
async def update_selected_shop_items_display_order(
    payload: ShopSelectedItemsOrderUpdate,
    shop: ShopDep,
    db: DBSession,
) -> ShopSelectedItemsOrderRead:
    """Persist the full per-shop selected item order used by billing."""
    return await update_selected_shop_items_order(db, shop, payload.item_ids)


@router.get(
    "/shops/{shop_id}/item-import-candidates",
    response_model=ShopItemPage,
    response_model_exclude_unset=True,
    summary="List Shop Item Import Candidates",
)
async def get_shop_item_import_candidates(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    limit: ItemsLimitParam = 100,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> ShopItemPage:
    """Return compact active catalogue items that are not yet selected for the shop."""
    return await list_shop_item_import_candidates(
        db,
        shop,
        q=q,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/shops/{shop_id}/item-import-candidates/rows",
    response_model=AdminItemRowsPage,
    response_model_exclude_unset=True,
    summary="List Shop Item Import Candidate Rows",
)
async def get_shop_item_import_candidate_rows(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
    limit: ItemsLimitParam = 100,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> AdminItemRowsPage:
    """Return row-first import candidates without exact count work."""
    return await list_shop_item_import_candidate_rows(
        db,
        shop,
        q=q,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/shops/{shop_id}/item-import-candidates/counts",
    response_model=ShopItemCounts,
    response_model_exclude_unset=True,
    summary="Count Shop Item Import Candidates",
)
async def get_shop_item_import_candidate_counts(
    shop: ShopDep,
    db: DBSession,
    q: ItemSearchParam = None,
) -> ShopItemCounts:
    """Return exact import candidate counts for background UI badges."""
    return await count_shop_item_import_candidates(db, shop, q=q)


@router.get(
    "/shops/{shop_id}/items/{item_id}",
    response_model=ShopItemRead,
    response_model_exclude_unset=True,
    summary="Get Shop Item Detail",
)
async def get_shop_item_detail(
    item_id: UUID,
    shop: ShopDep,
    db: DBSession,
) -> ShopItemRead:
    """Return one effective shop item row for route-safe editor loading."""
    return await get_shop_item(db, shop, item_id)


@router.post(
    "/shops/{shop_id}/item-allocations/bulk",
    response_model=ShopItemAllocationBulkRead,
    response_model_exclude_unset=True,
    summary="Allocate Catalogue Items",
)
async def allocate_shop_catalogue_items(
    payload: ShopItemAllocationBulkCreate,
    shop: ShopDep,
    db: DBSession,
) -> ShopItemAllocationBulkRead:
    return await allocate_catalogue_items(db, shop, payload.item_ids)


@router.post(
    "/shops/{shop_id}/item-allocations/{item_id}",
    response_model=ShopItemRead,
    response_model_exclude_unset=True,
    summary="Allocate Catalogue Item",
)
async def allocate_shop_catalogue_item(
    item_id: UUID,
    shop: ShopDep,
    db: DBSession,
) -> ShopItemRead:
    return await allocate_catalogue_item(db, shop, item_id)


@router.patch(
    "/shops/{shop_id}/item-allocations/{item_id}",
    response_model=ShopItemRead,
    response_model_exclude_unset=True,
    summary="Update Catalogue Item Allocation",
)
async def update_shop_catalogue_item_allocation(
    item_id: UUID,
    payload: ShopItemAllocationUpdate,
    shop: ShopDep,
    db: DBSession,
) -> ShopItemRead:
    return await update_catalogue_item_allocation(db, shop, item_id, payload)


@router.delete(
    "/shops/{shop_id}/item-allocations/{item_id}",
    response_model=ShopItemRead,
    response_model_exclude_unset=True,
    summary="Deallocate Catalogue Item",
)
async def deallocate_shop_catalogue_item(
    item_id: UUID,
    shop: ShopDep,
    db: DBSession,
) -> ShopItemRead:
    return await deallocate_catalogue_item(db, shop, item_id)


@router.patch(
    "/shops/{shop_id}/items/{item_id}",
    response_model=ItemRead,
    response_model_exclude_unset=True,
    summary="Update Shop Item",
)
async def update_shop_inventory_item(
    item_id: UUID,
    name: Annotated[
        str, Form(min_length=2, max_length=120, description="Updated display name of the item.")
    ],
    unit_type: Annotated[
        UnitType,
        Form(description="Updated quantity mode: `weight` or `count`."),
    ],
    base_unit: Annotated[
        BaseUnit,
        Form(description="Updated billing unit: `kg` or `unit`."),
    ],
    tamil_name: Annotated[
        str,
        Form(min_length=1, max_length=120, description="Updated Tamil display name of the item."),
    ],
    shop: ShopDep,
    db: DBSession,
    is_active: Annotated[
        bool,
        Form(description="Whether the item remains available for pricing and billing."),
    ] = True,
    custom_attributes: Annotated[
        str,
        Form(description="JSON object with admin-defined item attributes."),
    ] = "{}",
    sort_order: Annotated[int, Form(description="Display sort order for item lists.")] = 0,
    category: Annotated[
        str | None, Form(max_length=80, description="Optional display category.")
    ] = None,
    category_id: Annotated[
        UUID | None, Form(description="Optional reusable item category ID.")
    ] = None,
    remove_image: Annotated[
        bool,
        Form(description="Remove the stored image when no replacement image is uploaded."),
    ] = False,
    image: ItemImageUploadOptional = None,
) -> ItemRead:
    payload = ItemUpdate(
        name=name,
        tamil_name=tamil_name,
        unit_type=unit_type,
        base_unit=base_unit,
        is_active=is_active,
        sort_order=sort_order,
        category_id=category_id,
        category=category,
        custom_attributes=_parse_custom_attributes(custom_attributes),
    )
    return await update_item(
        db,
        item_id,
        payload,
        image=image,
        shop_id=shop.id,
        remove_image=remove_image,
    )


@router.post(
    "/shops/{shop_id}/items/{item_id}/confirm-delete",
    status_code=204,
    summary="Confirm Delete Shop Item",
    description=(
        "Permanently delete a shop-owned item after re-authenticating the current "
        "tenant admin. Rejects items with billing or price history."
    ),
)
@router.delete(
    "/shops/{shop_id}/items/{item_id}",
    status_code=204,
    summary="Delete Shop Item",
    description=(
        "Same as POST .../confirm-delete. Requires tenant-admin username and password "
        "in the body. Prefer POST for clients that do not send DELETE bodies."
    ),
)
async def delete_shop_inventory_item(
    item_id: UUID,
    payload: ConfirmDeleteRequest,
    shop: ShopDep,
    db: DBSession,
    current_user: AdminUserDep,
) -> Response:
    await verify_tenant_admin_credentials(
        db,
        current_user,
        username=payload.username,
        password=payload.password,
    )
    await delete_item(db, item_id, shop_id=shop.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/items/rows",
    response_model=AdminItemRowsPage,
    response_model_exclude_unset=True,
    summary="List Catalogue Item Rows",
)
async def get_catalogue_item_rows(
    db: DBSession,
    current_user: AdminUserDep,
    q: ItemSearchParam = None,
    active: ItemActiveParam = None,
    limit: ItemsLimitParam = 100,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> AdminItemRowsPage:
    """Return row-first global catalogue item data without count-heavy joins."""
    return await list_catalogue_item_rows(
        db,
        _require_org_id(current_user),
        q=q,
        active=active,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.get(
    "/items/counts",
    response_model=ShopItemCounts,
    response_model_exclude_unset=True,
    summary="Count Catalogue Items",
)
async def get_catalogue_item_counts(
    db: DBSession,
    current_user: AdminUserDep,
    q: ItemSearchParam = None,
    active: ItemActiveParam = None,
) -> ShopItemCounts:
    """Return exact catalogue counts for background UI badges."""
    return await count_catalogue_items(db, _require_org_id(current_user), q=q, active=active)


@router.get(
    "/items",
    response_model=ShopItemPage,
    response_model_exclude_unset=True,
    summary="List Catalogue Items",
)
async def get_catalogue_items(
    db: DBSession,
    current_user: AdminUserDep,
    q: ItemSearchParam = None,
    allocated: ItemAllocatedParam = None,
    active: ItemActiveParam = None,
    limit: ItemsLimitParam = 500,
    cursor_sort_order: ItemCursorSortOrderParam = None,
    cursor_name: ItemCursorNameParam = None,
    cursor_id: ItemCursorIdParam = None,
) -> ShopItemPage:
    """Return global catalogue items with usage counts and pagination."""
    return await list_catalogue_items(
        db,
        _require_org_id(current_user),
        q=q,
        allocated=allocated,
        active=active,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )


@router.post(
    "/items",
    response_model=ItemRead,
    status_code=201,
    summary="Create Item",
    description=(
        "Create a new inventory item. Submit multipart form-data with the item fields and an optional "
        "`image` file. In production, image bytes are stored in RustFS while metadata and the object "
        "key are stored on the item row in Postgres."
    ),
)
async def create_inventory_item(
    name: Annotated[
        str, Form(min_length=2, max_length=120, description="Display name of the item.")
    ],
    unit_type: Annotated[
        UnitType,
        Form(description="High-level quantity mode: `weight` or `count`."),
    ],
    base_unit: Annotated[
        BaseUnit,
        Form(description="Base billing unit used for prices and quantities: `kg` or `unit`."),
    ],
    tamil_name: Annotated[
        str,
        Form(min_length=1, max_length=120, description="Tamil display name of the item."),
    ],
    db: DBSession,
    current_user: AdminUserDep,
    is_active: Annotated[
        bool,
        Form(
            description="Whether the item should be available for pricing and billing immediately."
        ),
    ] = True,
    custom_attributes: Annotated[
        str,
        Form(description="JSON object with admin-defined item attributes."),
    ] = "{}",
    sort_order: Annotated[int, Form(description="Display sort order for item lists.")] = 0,
    category: Annotated[
        str | None, Form(max_length=80, description="Optional display category.")
    ] = None,
    category_id: Annotated[
        UUID | None, Form(description="Optional reusable item category ID.")
    ] = None,
    image: ItemImageUploadOptional = None,
) -> ItemRead:
    """Create a new inventory item for pricing and billing, with an optional image upload."""
    payload = ItemCreate(
        name=name,
        tamil_name=tamil_name,
        unit_type=unit_type,
        base_unit=base_unit,
        is_active=is_active,
        sort_order=sort_order,
        category_id=category_id,
        category=category,
        custom_attributes=_parse_custom_attributes(custom_attributes),
    )
    return await create_item(
        db, payload, image=image, organization_id=_require_org_id(current_user)
    )


@router.get(
    "/items/{item_id}",
    response_model=ShopItemRead,
    response_model_exclude_unset=True,
    summary="Get Catalogue Item Detail",
)
async def get_catalogue_item_detail(
    item_id: UUID,
    db: DBSession,
    current_user: AdminUserDep,
) -> ShopItemRead:
    """Return a catalogue item with usage and delete eligibility for item routes."""
    return await get_catalogue_item(db, item_id, _require_org_id(current_user))


@router.patch(
    "/items/{item_id}",
    response_model=ItemRead,
    response_model_exclude_unset=True,
    summary="Update Item (Preferred)",
    description=(
        "Preferred endpoint for item edits. Update item metadata and optionally replace the image "
        "in the same multipart request. Use this endpoint for most admin item edit flows."
    ),
)
async def update_inventory_item(
    item_id: UUID,
    name: Annotated[
        str, Form(min_length=2, max_length=120, description="Updated display name of the item.")
    ],
    unit_type: Annotated[
        UnitType,
        Form(description="Updated quantity mode: `weight` or `count`."),
    ],
    base_unit: Annotated[
        BaseUnit,
        Form(description="Updated billing unit: `kg` or `unit`."),
    ],
    tamil_name: Annotated[
        str,
        Form(min_length=1, max_length=120, description="Updated Tamil display name of the item."),
    ],
    db: DBSession,
    is_active: Annotated[
        bool,
        Form(description="Whether the item remains available for pricing and billing."),
    ],
    custom_attributes: Annotated[
        str,
        Form(description="JSON object with admin-defined item attributes."),
    ] = "{}",
    sort_order: Annotated[int, Form(description="Display sort order for item lists.")] = 0,
    category: Annotated[
        str | None, Form(max_length=80, description="Optional display category.")
    ] = None,
    category_id: Annotated[
        UUID | None, Form(description="Optional reusable item category ID.")
    ] = None,
    remove_image: Annotated[
        bool,
        Form(description="Remove the stored image when no replacement image is uploaded."),
    ] = False,
    image: ItemImageUploadOptional = None,
) -> ItemRead:
    """Update item metadata, active state, and optionally replace its image."""
    payload = ItemUpdate(
        name=name,
        tamil_name=tamil_name,
        unit_type=unit_type,
        base_unit=base_unit,
        is_active=is_active,
        sort_order=sort_order,
        category_id=category_id,
        category=category,
        custom_attributes=_parse_custom_attributes(custom_attributes),
    )
    return await update_item(db, item_id, payload, image=image, remove_image=remove_image)


@router.patch(
    "/items/{item_id}/metadata",
    response_model=ItemRead,
    response_model_exclude_unset=True,
    summary="Patch Catalogue Item Metadata",
)
async def patch_inventory_item_metadata(
    item_id: UUID,
    payload: ItemMetadataUpdate,
    db: DBSession,
) -> ItemRead:
    """Partially update item metadata without requiring multipart form-data."""
    return await update_item_metadata(db, item_id, payload)


@router.patch(
    "/items/{item_id}/assumption",
    response_model=ItemRead,
    response_model_exclude_unset=True,
    summary="Patch Catalogue Item Assumption",
)
async def patch_inventory_item_assumption(
    item_id: UUID,
    payload: ItemAssumptionUpdate,
    db: DBSession,
) -> ItemRead:
    """Configure or clear the inventory deduction assumption for a catalogue item."""
    return await update_item_assumption(db, item_id, payload)


@router.patch(
    "/shops/{shop_id}/items/{item_id}/metadata",
    response_model=ItemRead,
    response_model_exclude_unset=True,
    summary="Patch Shop Item Metadata",
)
async def patch_shop_inventory_item_metadata(
    item_id: UUID,
    payload: ItemMetadataUpdate,
    shop: ShopDep,
    db: DBSession,
) -> ItemRead:
    """Partially update shop-owned item metadata without requiring multipart form-data."""
    return await update_item_metadata(db, item_id, payload, shop_id=shop.id)


@router.put(
    "/items/{item_id}/image",
    response_model=ItemImageRead,
    response_model_exclude_unset=True,
    summary="Replace Item Image (Convenience)",
    deprecated=True,
    description=(
        "Deprecated convenience endpoint for image-only updates. Prefer `PATCH /items/{item_id}` "
        "when the client can submit item fields and image together. Keep using this route only "
        "for clients that edit the image separately from the rest of the item metadata."
    ),
)
async def upload_inventory_item_image(
    item_id: UUID,
    image: ItemImageUploadRequired,
    db: DBSession,
) -> ItemImageRead:
    """Upload or replace an item's image in RustFS and persist metadata in Postgres."""
    return await upload_item_image(db, item_id, image)


@router.delete(
    "/items/{item_id}/image",
    response_model=ItemImageRead,
    response_model_exclude_unset=True,
    summary="Remove Item Image",
)
async def delete_inventory_item_image(
    item_id: UUID,
    db: DBSession,
) -> ItemImageRead:
    """Remove an item's RustFS image reference and delete the object when possible."""
    return await delete_item_image(db, item_id)


@router.post(
    "/items/{item_id}/confirm-delete",
    status_code=204,
    summary="Confirm Delete Catalogue Item",
    description=(
        "Permanently delete a catalogue item after re-authenticating the current "
        "tenant admin. Rejects items with shop allocations, billing, or price history. "
        "If an image exists, its RustFS object is removed after the database delete succeeds."
    ),
)
@router.delete(
    "/items/{item_id}",
    status_code=204,
    summary="Delete Item",
    description=(
        "Same as POST .../confirm-delete. Requires tenant-admin username and password "
        "in the body. Prefer POST for clients that do not send DELETE bodies."
    ),
)
async def delete_inventory_item(
    item_id: UUID,
    payload: ConfirmDeleteRequest,
    db: DBSession,
    current_user: AdminUserDep,
) -> Response:
    """Delete a catalogue item only when it has no billing or price history."""
    await verify_tenant_admin_credentials(
        db,
        current_user,
        username=payload.username,
        password=payload.password,
    )
    await delete_item(db, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
