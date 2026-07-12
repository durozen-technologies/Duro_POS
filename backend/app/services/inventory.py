from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import and_, case, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.ids import uuid7
from app.core.timezone import ist_midnight
from app.db.storage import (
    build_inventory_item_image_path,
    build_inventory_item_image_thumb_path,
    delete_item_image_storage,
    save_inventory_item_image_upload,
)
from app.db.storage import (
    delete_inventory_item_image as delete_inventory_item_image_storage,
)
from app.models import (
    BaseUnit,
    InventoryCategory,
    InventoryItem,
    InventoryItemBillingMapping,
    InventoryItemCategory,
    InventoryItemPurchaseRateHistory,
    InventoryMovement,
    InventoryMovementType,
    InventoryTransfer,
    Item,
    RetailerInventoryUsage,
    Shop,
    ShopInventoryAllocation,
    TransferShop,
    User,
)
from app.models.inventory import InventoryMovementSplit
from app.schemas.inventory import (
    InventoryAddRequest,
    InventoryBillingItemMappingRead,
    InventoryBillingItemMappingWrite,
    InventoryCategoryCreate,
    InventoryCategoryRead,
    InventoryCategoryUpdate,
    InventoryCategoryUsageRead,
    InventoryItemCounts,
    InventoryItemCreate,
    InventoryItemImageRead,
    InventoryItemPurchaseRateUpdate,
    InventoryItemRead,
    InventoryItemRowsPage,
    InventoryItemStockRead,
    InventoryItemUpdate,
    InventoryMovementCreateResult,
    InventoryMovementPage,
    InventoryMovementRead,
    InventoryMovementSplitCreateResult,
    InventoryStockAdjustRequest,
    InventoryStockRowsPage,
    InventorySummaryRead,
    InventoryUseRequest,
    InventoryUseSplitRequest,
    ShopInventoryAllocationBulkRead,
)
from app.services.tenant_query import resolve_organization_id

from ..schemas.transfer import InventoryTransferPage, InventoryTransferRead
from .inventory_backdate import prepare_inventory_occurred_at

ZERO = Decimal("0")
THREE_DECIMALS = Decimal("0.001")


def _quantity_exceeds_available(requested: Decimal, available: Decimal) -> bool:
    return requested.quantize(THREE_DECIMALS) > available.quantize(THREE_DECIMALS)


def _normalize_inventory_category_name(raw_name: str) -> str:
    category_name = raw_name.strip()
    if not category_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Inventory category name is required",
        )
    return category_name


def _normalize_inventory_item_name(raw_name: str) -> str:
    item_name = raw_name.strip()
    if len(item_name) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Inventory item name is required",
        )
    return item_name


def _normalize_tamil_inventory_item_name(raw_name: str) -> str:
    item_name = raw_name.strip()
    if not item_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Tamil inventory item name is required",
        )
    return item_name


def _normalize_quantity(unit: BaseUnit, quantity: Decimal) -> Decimal:
    normalized = quantity.quantize(THREE_DECIMALS)
    if normalized <= ZERO:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Inventory quantity must be greater than zero",
        )
    if unit == BaseUnit.UNIT and normalized != normalized.to_integral_value():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Unit inventory quantities must be whole numbers",
        )
    return normalized


def _normalize_nonnegative_quantity(unit: BaseUnit, quantity: Decimal) -> Decimal:
    normalized = quantity.quantize(THREE_DECIMALS)
    if normalized < ZERO:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Inventory quantity cannot be negative",
        )
    if unit == BaseUnit.UNIT and normalized != normalized.to_integral_value():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Unit inventory quantities must be whole numbers",
        )
    return normalized


def _category_to_read(category: InventoryCategory) -> InventoryCategoryRead:
    return InventoryCategoryRead.model_validate(category)


def _item_categories(item: InventoryItem) -> list[InventoryCategory]:
    links = item.__dict__.get("category_links") or []
    categories = [link.category for link in links if link.category is not None]
    return sorted(categories, key=lambda category: (category.name.lower(), str(category.id)))


def _inventory_item_to_read(item: InventoryItem) -> InventoryItemRead:
    categories = _item_categories(item)
    return _inventory_item_to_read_with_categories(item, categories)


def _inventory_item_to_read_with_categories(
    item: InventoryItem,
    categories: list[InventoryCategory],
) -> InventoryItemRead:
    sorted_categories = sorted(
        categories, key=lambda category: (category.name.lower(), str(category.id))
    )
    mapping_rows = item.__dict__.get("billing_mappings") or []
    item_mappings = _item_mapping_reads_from_links(mapping_rows)
    item_level_mapping = next(
        (mapping for mapping in item_mappings if mapping.inventory_category_id is None),
        None,
    )
    return InventoryItemRead(
        id=item.id,
        name=item.name,
        tamil_name=item.tamil_name,
        unit_type=item.unit_type,
        base_unit=item.base_unit,
        sort_order=item.sort_order,
        is_active=item.is_active,
        purchase_rate=item.purchase_rate,
        billing_item_id=(
            item_level_mapping.billing_item_id if item_level_mapping is not None else None
        ),
        billing_item_ids=[mapping.billing_item_id for mapping in item_mappings],
        billing_items=item_mappings,
        category_ids=[category.id for category in sorted_categories],
        category_billing_item_ids={
            mapping.inventory_category_id: mapping.billing_item_id
            for mapping in item_mappings
            if mapping.inventory_category_id is not None
        },
        categories=[_category_to_read(category) for category in sorted_categories],
        created_at=item.created_at,
        updated_at=item.updated_at,
        image_path=build_inventory_item_image_path(
            item.id, item.image_object_key, item.image_content_type
        ),
        image_thumb_path=build_inventory_item_image_thumb_path(
            item.id,
            item.image_thumbnail_object_key,
            item.image_thumbnail_content_type,
            original_object_key=item.image_object_key,
        ),
        image_content_type=item.image_content_type,
    )


def _inventory_item_row_to_read(
    row,
    categories_by_item_id: dict[UUID, list[InventoryCategoryRead]],
    item_mappings_by_item_id: dict[UUID, list[InventoryBillingItemMappingRead]],
) -> InventoryItemRead:
    categories = categories_by_item_id.get(row.id, [])
    item_mappings = item_mappings_by_item_id.get(row.id, [])
    item_level_mapping = next(
        (mapping for mapping in item_mappings if mapping.inventory_category_id is None),
        None,
    )
    return InventoryItemRead(
        id=row.id,
        name=row.name,
        tamil_name=row.tamil_name,
        unit_type=row.unit_type,
        base_unit=row.base_unit,
        sort_order=row.sort_order,
        is_active=row.is_active,
        purchase_rate=row.purchase_rate,
        billing_item_id=(
            item_level_mapping.billing_item_id if item_level_mapping is not None else None
        ),
        billing_item_ids=[mapping.billing_item_id for mapping in item_mappings],
        billing_items=item_mappings,
        category_ids=[category.id for category in categories],
        category_billing_item_ids={
            mapping.inventory_category_id: mapping.billing_item_id
            for mapping in item_mappings
            if mapping.inventory_category_id is not None
        },
        categories=categories,
        created_at=row.created_at,
        updated_at=row.updated_at,
        image_path=build_inventory_item_image_path(
            row.id, row.image_object_key, row.image_content_type
        ),
        image_thumb_path=build_inventory_item_image_thumb_path(
            row.id,
            row.image_thumbnail_object_key,
            row.image_thumbnail_content_type,
            original_object_key=row.image_object_key,
        ),
        image_content_type=row.image_content_type,
    )


async def _ensure_unique_inventory_item_name(
    db: AsyncSession,
    item_name: str,
    *,
    organization_id: UUID | None = None,
    exclude_item_id: UUID | None = None,
) -> None:
    org_id = organization_id or await resolve_organization_id(db)
    filters = [
        func.lower(InventoryItem.name) == item_name.lower(),
        InventoryItem.organization_id == org_id,
    ]
    if exclude_item_id is not None:
        filters.append(InventoryItem.id != exclude_item_id)
    existing_item = await db.scalar(select(InventoryItem.id).where(*filters).limit(1))
    if existing_item is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Inventory item name already exists",
        )


def _billing_mapping_read_from_item(
    item: Item,
    *,
    inventory_category_id: UUID | None = None,
    inventory_category_name: str | None = None,
) -> InventoryBillingItemMappingRead:
    return InventoryBillingItemMappingRead(
        inventory_category_id=inventory_category_id,
        inventory_category_name=inventory_category_name,
        billing_item_id=item.id,
        billing_item_name=item.name,
        billing_item_tamil_name=item.tamil_name,
    )


def _item_mapping_reads_from_links(
    mapping_rows: list[InventoryItemBillingMapping],
) -> list[InventoryBillingItemMappingRead]:
    item_mappings: list[InventoryBillingItemMappingRead] = []
    for mapping in mapping_rows:
        billing_item = mapping.billing_item
        if billing_item is None:
            continue
        inventory_category = mapping.inventory_category
        item_mappings.append(
            _billing_mapping_read_from_item(
                billing_item,
                inventory_category_id=mapping.inventory_category_id,
                inventory_category_name=(
                    inventory_category.name if inventory_category is not None else None
                ),
            )
        )
    return item_mappings


def _billing_mapping_specs_from_payload(
    payload: InventoryItemCreate | InventoryItemUpdate,
) -> list[InventoryBillingItemMappingWrite]:
    if payload.billing_mappings:
        return [
            InventoryBillingItemMappingWrite(
                inventory_category_id=mapping.inventory_category_id,
                billing_item_id=mapping.billing_item_id,
            )
            for mapping in payload.billing_mappings
        ]

    legacy_billing_item_ids = list(dict.fromkeys(payload.billing_item_ids))
    if (
        payload.billing_item_id is not None
        and payload.billing_item_id not in legacy_billing_item_ids
    ):
        legacy_billing_item_ids.insert(0, payload.billing_item_id)
    if not legacy_billing_item_ids:
        return []
    if len(legacy_billing_item_ids) > 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Only one billing item can be mapped to an inventory item without categories",
        )
    return [
        InventoryBillingItemMappingWrite(
            inventory_category_id=None,
            billing_item_id=legacy_billing_item_ids[0],
        )
    ]


async def _resolve_billing_mappings(
    db: AsyncSession,
    payload: InventoryItemCreate | InventoryItemUpdate,
    categories: list[InventoryCategory],
    base_unit: BaseUnit,
    *,
    item_id: UUID | None = None,
) -> list[InventoryBillingItemMappingWrite]:
    mapping_specs = _billing_mapping_specs_from_payload(payload)
    category_ids = {category.id for category in categories}
    if category_ids and len(category_ids) == 1:
        only_category_id = next(iter(category_ids))
        mapping_specs = [
            InventoryBillingItemMappingWrite(
                inventory_category_id=(
                    only_category_id
                    if mapping.inventory_category_id is None
                    else mapping.inventory_category_id
                ),
                billing_item_id=mapping.billing_item_id,
            )
            for mapping in mapping_specs
        ]
    if not category_ids:
        category_mapping = next(
            (mapping for mapping in mapping_specs if mapping.inventory_category_id is not None),
            None,
        )
        if category_mapping is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Inventory category mappings require a selected inventory category",
            )
    else:
        item_level_mapping = next(
            (mapping for mapping in mapping_specs if mapping.inventory_category_id is None),
            None,
        )
        if item_level_mapping is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Inventory items with categories must map billing items per category",
            )

    seen_category_ids: set[UUID | None] = set()
    seen_billing_item_ids: set[UUID] = set()
    for mapping in mapping_specs:
        if (
            mapping.inventory_category_id not in category_ids
            and mapping.inventory_category_id is not None
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Mapped inventory category must be linked to this inventory item",
            )
        if mapping.inventory_category_id in seen_category_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Only one billing item can be mapped to each inventory category",
            )
        if mapping.billing_item_id in seen_billing_item_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A billing item can only be mapped once",
            )
        seen_category_ids.add(mapping.inventory_category_id)
        seen_billing_item_ids.add(mapping.billing_item_id)

    unique_billing_item_ids = list(seen_billing_item_ids)
    if not unique_billing_item_ids:
        return []

    billing_items = (
        await db.scalars(select(Item).where(Item.id.in_(unique_billing_item_ids)))
    ).all()
    billing_items_by_id = {item.id: item for item in billing_items}
    missing_item_ids = [
        item_id for item_id in unique_billing_item_ids if item_id not in billing_items_by_id
    ]
    if missing_item_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Billing item not found")

    for billing_item in billing_items:
        if billing_item.shop_id is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Mapped billing item must be a catalogue item",
            )
        if billing_item.base_unit != base_unit:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Mapped billing item unit must match the inventory item unit",
            )
    existing_mapping_rows = (
        await db.scalars(
            select(InventoryItemBillingMapping).where(
                InventoryItemBillingMapping.billing_item_id.in_(unique_billing_item_ids)
            )
        )
    ).all()
    conflicting_mapping = next(
        (
            mapping
            for mapping in existing_mapping_rows
            if item_id is None or mapping.inventory_item_id != item_id
        ),
        None,
    )
    if conflicting_mapping is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Billing item is already mapped to another inventory item",
        )
    return mapping_specs


async def _replace_billing_mappings(
    db: AsyncSession,
    item_id: UUID,
    mapping_specs: list[InventoryBillingItemMappingWrite],
) -> None:
    existing_rows = (
        await db.scalars(
            select(InventoryItemBillingMapping).where(
                InventoryItemBillingMapping.inventory_item_id == item_id
            )
        )
    ).all()
    for existing_row in existing_rows:
        await db.delete(existing_row)
    await db.flush()
    for mapping in mapping_specs:
        db.add(
            InventoryItemBillingMapping(
                inventory_item_id=item_id,
                inventory_category_id=mapping.inventory_category_id,
                billing_item_id=mapping.billing_item_id,
            )
        )


async def list_inventory_categories(
    db: AsyncSession, organization_id: UUID | None = None
) -> list[InventoryCategoryRead]:
    org_id = organization_id or await resolve_organization_id(db)
    rows = await db.scalars(
        select(InventoryCategory)
        .where(InventoryCategory.organization_id == org_id)
        .order_by(func.lower(InventoryCategory.name), InventoryCategory.id)
    )
    return [_category_to_read(category) for category in rows.all()]


async def create_inventory_category(
    db: AsyncSession,
    payload: InventoryCategoryCreate,
) -> InventoryCategoryRead:
    org_id = await resolve_organization_id(db)
    category_name = _normalize_inventory_category_name(payload.name)
    existing = await db.scalar(
        select(InventoryCategory.id).where(
            func.lower(InventoryCategory.name) == category_name.lower(),
            InventoryCategory.organization_id == org_id,
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Inventory category already exists",
        )
    category = InventoryCategory(name=category_name, organization_id=org_id)
    db.add(category)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Inventory category already exists",
        ) from None
    return _category_to_read(category)


async def update_inventory_category(
    db: AsyncSession,
    category_id: UUID,
    payload: InventoryCategoryUpdate,
) -> InventoryCategoryRead:
    category_name = _normalize_inventory_category_name(payload.name)
    category = await db.scalar(
        select(InventoryCategory).where(InventoryCategory.id == category_id).with_for_update()
    )
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inventory category not found"
        )
    if category.name == category_name:
        return _category_to_read(category)
    existing = await db.scalar(
        select(InventoryCategory.id)
        .where(
            func.lower(InventoryCategory.name) == category_name.lower(),
            InventoryCategory.id != category_id,
        )
        .limit(1)
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Inventory category already exists",
        )
    category.name = category_name
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Inventory category already exists",
        ) from None
    return _category_to_read(category)


async def delete_inventory_category(db: AsyncSession, category_id: UUID) -> None:
    category = await db.scalar(
        select(InventoryCategory).where(InventoryCategory.id == category_id).with_for_update()
    )
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inventory category not found"
        )
    has_item_links = await db.scalar(
        select(InventoryItemCategory.id)
        .where(InventoryItemCategory.category_id == category_id)
        .limit(1)
    )
    if has_item_links is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete an inventory category linked to inventory items",
        )
    has_movements = await db.scalar(
        select(InventoryMovement.id).where(InventoryMovement.category_id == category_id).limit(1)
    )
    if has_movements is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete an inventory category with movement history",
        )
    has_movement_splits = await db.scalar(
        select(InventoryMovementSplit.id)
        .where(InventoryMovementSplit.category_id == category_id)
        .limit(1)
    )
    if has_movement_splits is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete an inventory category with movement history",
        )
    has_retailer_usage = await db.scalar(
        select(RetailerInventoryUsage.id)
        .where(RetailerInventoryUsage.category_id == category_id)
        .limit(1)
    )
    if has_retailer_usage is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete an inventory category with retailer usage history",
        )
    await db.delete(category)
    await db.commit()


async def _resolve_inventory_categories(
    db: AsyncSession,
    category_ids: list[UUID],
    organization_id: UUID | None = None,
) -> list[InventoryCategory]:
    org_id = organization_id or await resolve_organization_id(db)
    unique_category_ids = list(dict.fromkeys(category_ids))
    if not unique_category_ids:
        return []
    categories = (
        await db.scalars(
            select(InventoryCategory).where(
                InventoryCategory.id.in_(unique_category_ids),
                InventoryCategory.organization_id == org_id,
            )
        )
    ).all()
    categories_by_id = {category.id: category for category in categories}
    missing_category_ids = [
        category_id for category_id in unique_category_ids if category_id not in categories_by_id
    ]
    if missing_category_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory category not found",
        )
    return [categories_by_id[category_id] for category_id in unique_category_ids]


def _inventory_items_row_query(*, q: str | None = None, active: bool | None = None):
    query = select(
        InventoryItem.id,
        InventoryItem.name,
        InventoryItem.tamil_name,
        InventoryItem.unit_type,
        InventoryItem.base_unit,
        InventoryItem.sort_order,
        InventoryItem.is_active,
        InventoryItem.purchase_rate,
        InventoryItem.created_at,
        InventoryItem.updated_at,
        InventoryItem.image_object_key,
        InventoryItem.image_content_type,
        InventoryItem.image_thumbnail_object_key,
        InventoryItem.image_thumbnail_content_type,
    )
    search = q.strip() if q else ""
    if search:
        like_search = f"%{search.lower()}%"
        query = query.where(
            or_(
                func.lower(InventoryItem.name).like(like_search),
                func.lower(InventoryItem.tamil_name).like(like_search),
            )
        )
    if active is not None:
        query = query.where(InventoryItem.is_active.is_(active))
    return query


def _inventory_item_cursor_filter(
    cursor_sort_order: int | None,
    cursor_name: str | None,
    cursor_id: UUID | None,
    cursor_is_active: bool | None = None,
):
    if cursor_name is None or cursor_id is None:
        return None
    sort_name_expr = func.lower(InventoryItem.name)
    
    if cursor_is_active is not None:
        if cursor_sort_order is None:
            cursor_sort_order = 0
            
        return or_(
            and_(InventoryItem.is_active.is_(False), cursor_is_active is True),
            and_(
                InventoryItem.is_active.is_(cursor_is_active),
                InventoryItem.sort_order > cursor_sort_order,
            ),
            and_(
                InventoryItem.is_active.is_(cursor_is_active),
                InventoryItem.sort_order == cursor_sort_order,
                sort_name_expr > cursor_name.lower(),
            ),
            and_(
                InventoryItem.is_active.is_(cursor_is_active),
                InventoryItem.sort_order == cursor_sort_order,
                sort_name_expr == cursor_name.lower(),
                InventoryItem.id > cursor_id,
            ),
        )

    if cursor_sort_order is None:
        return or_(
            sort_name_expr > cursor_name.lower(),
            and_(sort_name_expr == cursor_name.lower(), InventoryItem.id > cursor_id),
        )
    return or_(
        InventoryItem.sort_order > cursor_sort_order,
        and_(InventoryItem.sort_order == cursor_sort_order, sort_name_expr > cursor_name.lower()),
        and_(
            InventoryItem.sort_order == cursor_sort_order,
            sort_name_expr == cursor_name.lower(),
            InventoryItem.id > cursor_id,
        ),
    )


def _inventory_stock_cursor_filter(
    sort_order_expr,
    cursor_sort_order: int | None,
    cursor_name: str | None,
    cursor_id: UUID | None,
):
    if cursor_name is None or cursor_id is None:
        return None
    sort_name_expr = func.lower(InventoryItem.name)
    if cursor_sort_order is None:
        return or_(
            sort_name_expr > cursor_name.lower(),
            and_(sort_name_expr == cursor_name.lower(), InventoryItem.id > cursor_id),
        )
    return or_(
        sort_order_expr > cursor_sort_order,
        and_(sort_order_expr == cursor_sort_order, sort_name_expr > cursor_name.lower()),
        and_(
            sort_order_expr == cursor_sort_order,
            sort_name_expr == cursor_name.lower(),
            InventoryItem.id > cursor_id,
        ),
    )


async def _categories_by_inventory_item_id(
    db: AsyncSession,
    item_ids: list[UUID],
) -> dict[UUID, list[InventoryCategoryRead]]:
    if not item_ids:
        return {}
    category_rows = (
        await db.execute(
            select(
                InventoryItemCategory.inventory_item_id.label("inventory_item_id"),
                InventoryCategory.id.label("category_id"),
                InventoryCategory.name.label("category_name"),
                InventoryCategory.created_at.label("category_created_at"),
                InventoryCategory.updated_at.label("category_updated_at"),
            )
            .join(InventoryCategory, InventoryCategory.id == InventoryItemCategory.category_id)
            .where(InventoryItemCategory.inventory_item_id.in_(item_ids))
            .order_by(
                InventoryItemCategory.inventory_item_id,
                func.lower(InventoryCategory.name),
                InventoryCategory.id,
            )
        )
    ).all()
    categories_by_item_id: dict[UUID, list[InventoryCategoryRead]] = {}
    for category_row in category_rows:
        categories_by_item_id.setdefault(category_row.inventory_item_id, []).append(
            InventoryCategoryRead(
                id=category_row.category_id,
                name=category_row.category_name,
                created_at=category_row.category_created_at,
                updated_at=category_row.category_updated_at,
            )
        )
    return categories_by_item_id


async def _billing_mappings_by_inventory_item_id(
    db: AsyncSession,
    item_ids: list[UUID],
) -> dict[UUID, list[InventoryBillingItemMappingRead]]:
    if not item_ids:
        return {}
    rows = (
        await db.execute(
            select(
                InventoryItemBillingMapping.inventory_item_id,
                InventoryItemBillingMapping.inventory_category_id,
                InventoryCategory.name.label("inventory_category_name"),
                Item.id.label("billing_item_id"),
                Item.name.label("billing_item_name"),
                Item.tamil_name.label("billing_item_tamil_name"),
            )
            .join(Item, Item.id == InventoryItemBillingMapping.billing_item_id)
            .outerjoin(
                InventoryCategory,
                InventoryCategory.id == InventoryItemBillingMapping.inventory_category_id,
            )
            .where(InventoryItemBillingMapping.inventory_item_id.in_(item_ids))
            .order_by(
                InventoryItemBillingMapping.inventory_item_id,
                InventoryCategory.name.is_(None),
                func.lower(InventoryCategory.name),
                Item.sort_order,
                func.lower(Item.name),
                Item.id,
            )
        )
    ).all()
    item_mappings_by_item_id: dict[UUID, list[InventoryBillingItemMappingRead]] = {}
    for row in rows:
        item_mappings_by_item_id.setdefault(row.inventory_item_id, []).append(
            InventoryBillingItemMappingRead(
                inventory_category_id=row.inventory_category_id,
                inventory_category_name=row.inventory_category_name,
                billing_item_id=row.billing_item_id,
                billing_item_name=row.billing_item_name,
                billing_item_tamil_name=row.billing_item_tamil_name,
            )
        )
    return item_mappings_by_item_id


async def list_inventory_item_rows(
    db: AsyncSession,
    *,
    q: str | None = None,
    active: bool | None = None,
    limit: int = 100,
    cursor_sort_order: int | None = None,
    cursor_name: str | None = None,
    cursor_id: UUID | None = None,
    cursor_is_active: bool | None = None,
) -> InventoryItemRowsPage:
    query = _inventory_items_row_query(q=q, active=active)
    cursor_condition = _inventory_item_cursor_filter(
        cursor_sort_order,
        cursor_name,
        cursor_id,
        cursor_is_active,
    )
    if cursor_condition is not None:
        query = query.where(cursor_condition)

    rows = (
        await db.execute(
            query.order_by(
                InventoryItem.is_active.desc(),
                InventoryItem.sort_order,
                func.lower(InventoryItem.name),
                InventoryItem.id,
            ).limit(limit + 1)
        )
    ).all()
    page_rows = rows[:limit]
    has_more = len(rows) > limit
    item_ids = [row.id for row in page_rows]
    categories_by_item_id = await _categories_by_inventory_item_id(db, item_ids)
    item_mappings_by_item_id = await _billing_mappings_by_inventory_item_id(db, item_ids)

    next_cursor_sort_order = next_cursor_name = next_cursor_id = next_cursor_is_active = None
    if has_more and page_rows:
        last_row = page_rows[-1]
        next_cursor_sort_order = last_row.sort_order
        next_cursor_name = last_row.name.lower()
        next_cursor_id = last_row.id
        next_cursor_is_active = last_row.is_active

    return InventoryItemRowsPage(
        items=[
            _inventory_item_row_to_read(
                row,
                categories_by_item_id,
                item_mappings_by_item_id,
            )
            for row in page_rows
        ],
        limit=limit,
        has_more=has_more,
        next_cursor_sort_order=next_cursor_sort_order,
        next_cursor_name=next_cursor_name,
        next_cursor_id=next_cursor_id,
        next_cursor_is_active=next_cursor_is_active,
    )


async def count_inventory_items(
    db: AsyncSession,
    *,
    q: str | None = None,
    active: bool | None = None,
) -> InventoryItemCounts:
    count_source = _inventory_items_row_query(q=q, active=active).subquery()
    row = (
        (
            await db.execute(
                select(
                    func.count().label("all"),
                    func.coalesce(
                        func.sum(case((count_source.c.is_active.is_(True), 1), else_=0)),
                        0,
                    ).label("active"),
                    func.coalesce(
                        func.sum(case((count_source.c.is_active.is_(False), 1), else_=0)),
                        0,
                    ).label("paused"),
                ).select_from(count_source)
            )
        )
        .mappings()
        .one()
    )
    return InventoryItemCounts(
        all=int(row["all"] or 0),
        active=int(row["active"] or 0),
        paused=int(row["paused"] or 0),
    )


async def get_inventory_item(db: AsyncSession, item_id: UUID) -> InventoryItemRead:
    item = await db.scalar(
        select(InventoryItem)
        .where(InventoryItem.id == item_id)
        .options(
            selectinload(InventoryItem.billing_mappings).selectinload(
                InventoryItemBillingMapping.billing_item
            ),
            selectinload(InventoryItem.billing_mappings).selectinload(
                InventoryItemBillingMapping.inventory_category
            ),
            selectinload(InventoryItem.category_links).selectinload(InventoryItemCategory.category),
        )
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found"
        )
    return _inventory_item_to_read(item)


async def create_inventory_item(
    db: AsyncSession,
    payload: InventoryItemCreate,
    image: UploadFile | None = None,
    organization_id: UUID | None = None,
) -> InventoryItemRead:
    org_id = organization_id or await resolve_organization_id(db)
    item_name = _normalize_inventory_item_name(payload.name)
    tamil_name = _normalize_tamil_inventory_item_name(payload.tamil_name)
    await _ensure_unique_inventory_item_name(db, item_name, organization_id=org_id)
    categories = await _resolve_inventory_categories(
        db, payload.category_ids, organization_id=org_id
    )
    billing_mappings = await _resolve_billing_mappings(
        db,
        payload,
        categories,
        payload.base_unit,
    )

    item = InventoryItem(
        name=item_name,
        tamil_name=tamil_name,
        unit_type=payload.unit_type,
        base_unit=payload.base_unit,
        sort_order=payload.sort_order,
        is_active=payload.is_active,
        organization_id=org_id,
    )
    uploaded_image_object_key: str | None = None
    uploaded_thumbnail_object_key: str | None = None
    try:
        db.add(item)
        await db.flush()
        for category in categories:
            db.add(InventoryItemCategory(inventory_item_id=item.id, category_id=category.id))
        await _replace_billing_mappings(db, item.id, billing_mappings)
        if image is not None:
            await save_inventory_item_image_upload(db, item, image, commit=False)
            uploaded_image_object_key = item.image_object_key
            uploaded_thumbnail_object_key = item.image_thumbnail_object_key
        await db.commit()
    except IntegrityError:
        await db.rollback()
        await delete_item_image_storage(uploaded_image_object_key, uploaded_thumbnail_object_key)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Inventory item name already exists",
        ) from None
    except Exception:
        await db.rollback()
        await delete_item_image_storage(uploaded_image_object_key, uploaded_thumbnail_object_key)
        raise
    return await get_inventory_item(db, item.id)


async def update_inventory_item(
    db: AsyncSession,
    item_id: UUID,
    payload: InventoryItemUpdate,
    image: UploadFile | None = None,
    *,
    remove_image: bool = False,
) -> InventoryItemRead:
    item = await db.scalar(
        select(InventoryItem)
        .where(InventoryItem.id == item_id)
        .options(selectinload(InventoryItem.category_links))
        .with_for_update()
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found"
        )
    item_name = _normalize_inventory_item_name(payload.name)
    tamil_name = _normalize_tamil_inventory_item_name(payload.tamil_name)
    if item.name.lower() != item_name.lower():
        await _ensure_unique_inventory_item_name(
            db, item_name, organization_id=item.organization_id, exclude_item_id=item_id
        )
    categories = await _resolve_inventory_categories(
        db, payload.category_ids, organization_id=item.organization_id
    )
    billing_mappings = await _resolve_billing_mappings(
        db,
        payload,
        categories,
        payload.base_unit,
        item_id=item_id,
    )
    next_category_ids = {category.id for category in categories}
    removed_category_ids = {
        link.category_id
        for link in item.category_links
        if link.category_id not in next_category_ids
    }
    if removed_category_ids:
        has_usage_history = await db.scalar(
            select(InventoryMovement.id)
            .where(
                InventoryMovement.inventory_item_id == item.id,
                InventoryMovement.category_id.in_(removed_category_ids),
                InventoryMovement.movement_type == InventoryMovementType.USE,
            )
            .limit(1)
        )
        if has_usage_history is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot remove an inventory item category with usage history",
            )

    previous_image_object_key = item.image_object_key
    previous_thumbnail_object_key = item.image_thumbnail_object_key
    uploaded_image_object_key: str | None = None
    uploaded_thumbnail_object_key: str | None = None
    should_remove_image = (
        remove_image
        and image is None
        and bool(item.image_object_key or item.image_thumbnail_object_key)
    )

    try:
        item.name = item_name
        item.tamil_name = tamil_name
        item.unit_type = payload.unit_type
        item.base_unit = payload.base_unit
        item.sort_order = payload.sort_order
        item.is_active = payload.is_active
        if should_remove_image:
            item.image_object_key = None
            item.image_content_type = None
            item.image_thumbnail_object_key = None
            item.image_thumbnail_content_type = None
        for link in list(item.category_links):
            await db.delete(link)
        await db.flush()
        for category in categories:
            db.add(InventoryItemCategory(inventory_item_id=item.id, category_id=category.id))
        await _replace_billing_mappings(db, item.id, billing_mappings)
        if image is not None:
            await save_inventory_item_image_upload(db, item, image, commit=False)
            uploaded_image_object_key = item.image_object_key
            uploaded_thumbnail_object_key = item.image_thumbnail_object_key
        await db.commit()
        await db.refresh(item)
        if (
            (image is not None or should_remove_image)
            and previous_image_object_key
            and previous_image_object_key != item.image_object_key
        ):
            await delete_item_image_storage(previous_image_object_key)
        if (
            (image is not None or should_remove_image)
            and previous_thumbnail_object_key
            and previous_thumbnail_object_key != item.image_thumbnail_object_key
        ):
            await delete_item_image_storage(previous_thumbnail_object_key)
    except IntegrityError:
        await db.rollback()
        if uploaded_image_object_key and uploaded_image_object_key != previous_image_object_key:
            await delete_item_image_storage(uploaded_image_object_key)
        if (
            uploaded_thumbnail_object_key
            and uploaded_thumbnail_object_key != previous_thumbnail_object_key
        ):
            await delete_item_image_storage(uploaded_thumbnail_object_key)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Inventory item name already exists",
        ) from None
    except Exception:
        await db.rollback()
        if uploaded_image_object_key and uploaded_image_object_key != previous_image_object_key:
            await delete_item_image_storage(uploaded_image_object_key)
        if (
            uploaded_thumbnail_object_key
            and uploaded_thumbnail_object_key != previous_thumbnail_object_key
        ):
            await delete_item_image_storage(uploaded_thumbnail_object_key)
        raise
    return await get_inventory_item(db, item.id)


async def update_inventory_item_purchase_rate(
    db: AsyncSession,
    item_id: UUID,
    payload: InventoryItemPurchaseRateUpdate,
) -> InventoryItemRead:
    item = await db.scalar(
        select(InventoryItem).where(InventoryItem.id == item_id).with_for_update()
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found"
        )
    item.purchase_rate = payload.purchase_rate
    await db.commit()
    return await get_inventory_item(db, item_id)


async def confirm_inventory_purchase_rates_today(db: AsyncSession) -> int:
    now = datetime.now(UTC)
    today = now.date()

    # Get active inventory items
    items = (
        await db.execute(
            select(InventoryItem.id, InventoryItem.purchase_rate).where(
                InventoryItem.is_active.is_(True)
            )
        )
    ).all()

    if not items:
        return 0

    # UPSERT the history for today
    values = [
        {
            "id": uuid7(),
            "inventory_item_id": item.id,
            "purchase_rate": item.purchase_rate,
            "date": today,
            "created_at": now,
            "updated_at": now,
        }
        for item in items
    ]

    stmt = pg_insert(InventoryItemPurchaseRateHistory).values(values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["inventory_item_id", "date"],
        set_={
            "purchase_rate": stmt.excluded.purchase_rate,
            "updated_at": stmt.excluded.updated_at,
        },
    )
    await db.execute(stmt)

    result = await db.execute(
        update(InventoryItem).where(InventoryItem.is_active.is_(True)).values(updated_at=now)
    )
    await db.commit()
    return int(result.rowcount or 0)


async def get_inventory_purchase_rates_history(
    db: AsyncSession, reference_date: date
) -> dict[UUID, Decimal]:
    rows = (
        await db.execute(
            select(
                InventoryItemPurchaseRateHistory.inventory_item_id,
                InventoryItemPurchaseRateHistory.purchase_rate,
            ).where(InventoryItemPurchaseRateHistory.date == reference_date)
        )
    ).all()
    return {row.inventory_item_id: row.purchase_rate for row in rows}


async def upload_inventory_item_image(
    db: AsyncSession,
    item_id: UUID,
    image: UploadFile,
) -> InventoryItemImageRead:
    item = await db.scalar(
        select(InventoryItem).where(InventoryItem.id == item_id).with_for_update()
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found"
        )
    return await save_inventory_item_image_upload(db, item, image)


async def remove_inventory_item_image(
    db: AsyncSession,
    item_id: UUID,
) -> InventoryItemImageRead:
    return await delete_inventory_item_image_storage(db, item_id)


async def delete_inventory_item(db: AsyncSession, item_id: UUID) -> None:
    item = await db.scalar(
        select(InventoryItem).where(InventoryItem.id == item_id).with_for_update()
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found"
        )
    image_object_key = item.image_object_key
    thumbnail_object_key = item.image_thumbnail_object_key
    await db.execute(
        update(Item)
        .where(Item.assumption_inventory_item_id == item_id)
        .values(
            assumption_inventory_item_id=None,
            assumption_inventory_category_id=None,
        )
    )
    await db.execute(
        delete(InventoryMovement).where(InventoryMovement.inventory_item_id == item_id)
    )
    await db.delete(item)
    await db.commit()
    await delete_item_image_storage(image_object_key, thumbnail_object_key)


async def _resolve_inventory_actor(db: AsyncSession, shop: Shop, actor: User | None) -> User:
    if actor is not None:
        return actor
    resolved = await db.scalar(select(User).where(User.id == shop.owner_user_id))
    if resolved is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Shop owner account is missing",
        )
    return resolved


async def _prepare_occurred_at(
    db: AsyncSession,
    *,
    actor: User | None,
    shop: Shop,
    raw: datetime | None,
) -> datetime:
    resolved_actor = await _resolve_inventory_actor(db, shop, actor)
    return await prepare_inventory_occurred_at(db, actor=resolved_actor, raw=raw)


async def _movement_totals(
    db: AsyncSession,
    shop_id: UUID,
    item_ids: list[UUID],
    *,
    used_since: date | None = None,
    as_of: datetime | None = None,
) -> tuple[
    dict[UUID, Decimal],
    dict[UUID, Decimal],
    dict[tuple[UUID, UUID], Decimal],
    dict[UUID, Decimal],
    dict[UUID, int],
    dict[UUID, int],
    dict[tuple[UUID, UUID], int],
    dict[UUID, int],
]:
    """Return quantity and bird-count totals for the given items.

    ``added`` is always the all-time total so that available stock is correct.
    ``used`` / ``category_used`` / ``transferred_out`` are filtered to movements on or after
    ``used_since`` when that parameter is supplied (e.g. today's date), which
    lets the shop screen display a daily-resetting used counter without losing
    any data in the database or history view.
    """
    empty: tuple[
        dict[UUID, Decimal],
        dict[UUID, Decimal],
        dict[tuple[UUID, UUID], Decimal],
        dict[UUID, Decimal],
        dict[UUID, int],
        dict[UUID, int],
        dict[tuple[UUID, UUID], int],
        dict[UUID, int],
    ] = ({}, {}, {}, {}, {}, {}, {}, {})
    if not item_ids:
        return empty

    # ADD movements — all-time unless point-in-time ``as_of`` is set
    add_filter = [
        InventoryMovement.shop_id == shop_id,
        InventoryMovement.inventory_item_id.in_(item_ids),
        InventoryMovement.movement_type == InventoryMovementType.ADD,
    ]
    if as_of is not None:
        add_filter.append(InventoryMovement.occurred_at <= as_of)
    add_rows = (
        await db.execute(
            select(
                InventoryMovement.inventory_item_id,
                func.coalesce(func.sum(InventoryMovement.quantity), 0).label("quantity"),
                func.coalesce(func.sum(InventoryMovement.bird_count), 0).label("bird_count"),
            )
            .where(*add_filter)
            .group_by(InventoryMovement.inventory_item_id)
        )
    ).all()
    added: dict[UUID, Decimal] = {row.inventory_item_id: row.quantity or ZERO for row in add_rows}
    added_bird: dict[UUID, int] = {
        row.inventory_item_id: int(row.bird_count or 0) for row in add_rows
    }

    # USE movements — optionally scoped to a start date
    use_filter = [
        InventoryMovement.shop_id == shop_id,
        InventoryMovement.inventory_item_id.in_(item_ids),
        InventoryMovement.movement_type == InventoryMovementType.USE,
    ]
    if used_since is not None:
        use_filter.append(
            InventoryMovement.occurred_at >= ist_midnight(used_since)
        )
    if as_of is not None:
        use_filter.append(InventoryMovement.occurred_at <= as_of)

    use_rows = (
        await db.execute(
            select(
                InventoryMovement.inventory_item_id,
                func.coalesce(func.sum(InventoryMovement.quantity), 0).label("quantity"),
                func.coalesce(func.sum(InventoryMovement.bird_count), 0).label("bird_count"),
            )
            .where(*use_filter)
            .group_by(InventoryMovement.inventory_item_id)
        )
    ).all()
    used: dict[UUID, Decimal] = {row.inventory_item_id: row.quantity or ZERO for row in use_rows}
    used_bird: dict[UUID, int] = {
        row.inventory_item_id: int(row.bird_count or 0) for row in use_rows
    }

    category_rows = (
        await db.execute(
            select(
                InventoryMovement.inventory_item_id,
                InventoryMovement.category_id,
                func.coalesce(func.sum(InventoryMovement.quantity), 0).label("quantity"),
                func.coalesce(func.sum(InventoryMovement.bird_count), 0).label("bird_count"),
            )
            .where(
                *use_filter,
                InventoryMovement.category_id.is_not(None),
            )
            .group_by(InventoryMovement.inventory_item_id, InventoryMovement.category_id)
        )
    ).all()
    category_used = {
        (row.inventory_item_id, row.category_id): row.quantity or ZERO for row in category_rows
    }
    category_used_bird = {
        (row.inventory_item_id, row.category_id): int(row.bird_count or 0) for row in category_rows
    }

    # TRANSFERRED_OUT — all-time unless scoped to a start date or point-in-time ``as_of``
    transfer_filter = [
        InventoryTransfer.source_shop_id == shop_id,
        InventoryTransfer.inventory_item_id.in_(item_ids),
    ]
    if used_since is not None:
        transfer_filter.append(
            InventoryTransfer.occurred_at >= ist_midnight(used_since)
        )
    if as_of is not None:
        transfer_filter.append(InventoryTransfer.occurred_at <= as_of)
    transfer_rows = (
        await db.execute(
            select(
                InventoryTransfer.inventory_item_id,
                func.coalesce(func.sum(InventoryTransfer.quantity), 0).label("quantity"),
                func.coalesce(func.sum(InventoryTransfer.bird_count), 0).label("bird_count"),
            )
            .where(*transfer_filter)
            .group_by(InventoryTransfer.inventory_item_id)
        )
    ).all()
    transferred_out = {row.inventory_item_id: row.quantity or ZERO for row in transfer_rows}
    transferred_out_bird = {
        row.inventory_item_id: int(row.bird_count or 0) for row in transfer_rows
    }

    return (
        added,
        used,
        category_used,
        transferred_out,
        added_bird,
        used_bird,
        category_used_bird,
        transferred_out_bird,
    )


async def _retailer_usage_totals(
    db: AsyncSession,
    shop_id: UUID,
    item_ids: list[UUID],
    *,
    used_since: date | None = None,
    as_of: datetime | None = None,
) -> tuple[
    dict[UUID, Decimal],
    dict[tuple[UUID, UUID], Decimal],
    dict[UUID, int],
    dict[tuple[UUID, UUID], int],
]:
    if not item_ids:
        return {}, {}, {}, {}

    usage_filter = [
        RetailerInventoryUsage.shop_id == shop_id,
        RetailerInventoryUsage.inventory_item_id.in_(item_ids),
    ]
    if used_since is not None:
        usage_filter.append(
            RetailerInventoryUsage.occurred_at
            >= ist_midnight(used_since)
        )
    if as_of is not None:
        usage_filter.append(RetailerInventoryUsage.occurred_at <= as_of)

    item_rows = (
        await db.execute(
            select(
                RetailerInventoryUsage.inventory_item_id,
                func.coalesce(func.sum(RetailerInventoryUsage.quantity), 0).label("quantity"),
                func.coalesce(func.sum(RetailerInventoryUsage.bird_count), 0).label("bird_count"),
            )
            .where(*usage_filter)
            .group_by(RetailerInventoryUsage.inventory_item_id)
        )
    ).all()
    item_totals = {row.inventory_item_id: row.quantity or ZERO for row in item_rows}
    item_bird_totals = {
        row.inventory_item_id: int(row.bird_count or 0) for row in item_rows
    }

    category_rows = (
        await db.execute(
            select(
                RetailerInventoryUsage.inventory_item_id,
                RetailerInventoryUsage.category_id,
                func.coalesce(func.sum(RetailerInventoryUsage.quantity), 0).label("quantity"),
                func.coalesce(func.sum(RetailerInventoryUsage.bird_count), 0).label("bird_count"),
            )
            .where(*usage_filter, RetailerInventoryUsage.category_id.is_not(None))
            .group_by(RetailerInventoryUsage.inventory_item_id, RetailerInventoryUsage.category_id)
        )
    ).all()
    category_totals = {
        (row.inventory_item_id, row.category_id): row.quantity or ZERO for row in category_rows
    }
    category_bird_totals = {
        (row.inventory_item_id, row.category_id): int(row.bird_count or 0) for row in category_rows
    }
    return item_totals, category_totals, item_bird_totals, category_bird_totals


async def _stock_last_updated_at_by_item_id(
    db: AsyncSession,
    shop_id: UUID,
    item_ids: list[UUID],
) -> dict[UUID, datetime | None]:
    unique_item_ids = list(dict.fromkeys(item_ids))
    if not unique_item_ids:
        return {}

    last_updated: dict[UUID, datetime | None] = dict.fromkeys(unique_item_ids)

    def _apply_rows(rows: list[object]) -> None:
        for row in rows:
            item_id = row.inventory_item_id
            occurred_at = row.last_at
            if occurred_at is None:
                continue
            current = last_updated.get(item_id)
            if current is None or occurred_at > current:
                last_updated[item_id] = occurred_at

    movement_rows = (
        await db.execute(
            select(
                InventoryMovement.inventory_item_id,
                func.max(InventoryMovement.occurred_at).label("last_at"),
            )
            .where(
                InventoryMovement.shop_id == shop_id,
                InventoryMovement.inventory_item_id.in_(unique_item_ids),
            )
            .group_by(InventoryMovement.inventory_item_id)
        )
    ).all()
    _apply_rows(movement_rows)

    usage_rows = (
        await db.execute(
            select(
                RetailerInventoryUsage.inventory_item_id,
                func.max(RetailerInventoryUsage.occurred_at).label("last_at"),
            )
            .where(
                RetailerInventoryUsage.shop_id == shop_id,
                RetailerInventoryUsage.inventory_item_id.in_(unique_item_ids),
            )
            .group_by(RetailerInventoryUsage.inventory_item_id)
        )
    ).all()
    _apply_rows(usage_rows)

    transfer_rows = (
        await db.execute(
            select(
                InventoryTransfer.inventory_item_id,
                func.max(InventoryTransfer.occurred_at).label("last_at"),
            )
            .where(
                InventoryTransfer.source_shop_id == shop_id,
                InventoryTransfer.inventory_item_id.in_(unique_item_ids),
            )
            .group_by(InventoryTransfer.inventory_item_id)
        )
    ).all()
    _apply_rows(transfer_rows)

    return last_updated


def _stock_item_from_inventory_item(
    item: InventoryItem,
    *,
    allocation: ShopInventoryAllocation | None,
    added_quantity: Decimal,
    used_quantity: Decimal,
    available_quantity: Decimal | None = None,
    transfer_stock: Decimal = ZERO,
    retailer_used_quantity: Decimal = ZERO,
    added_bird_count: int = 0,
    used_bird_count: int = 0,
    available_bird_count: int | None = None,
    transfer_bird_count: int = 0,
    retailer_used_bird_count: int = 0,
    category_used: dict[tuple[UUID, UUID], Decimal],
    category_retailer_used: dict[tuple[UUID, UUID], Decimal] | None = None,
    category_used_bird: dict[tuple[UUID, UUID], int] | None = None,
    category_retailer_used_bird: dict[tuple[UUID, UUID], int] | None = None,
    stock_last_updated_at: datetime | None = None,
) -> InventoryItemStockRead:
    """Build a stock read object.

    ``available_quantity`` may be supplied explicitly when the caller has
    separate all-time and display (e.g. today-scoped) ``used_quantity`` values.
    If omitted it is computed as ``added_quantity - used_quantity``.
    """
    base = _inventory_item_to_read(item)
    if available_quantity is None:
        available_quantity = added_quantity - used_quantity
    if available_bird_count is None:
        available_bird_count = _clamp_available_bird_count(
            added_bird_count - used_bird_count - transfer_bird_count - retailer_used_bird_count
        )
    else:
        available_bird_count = _clamp_available_bird_count(available_bird_count)

    category_retailer_used = category_retailer_used or {}
    category_used_bird = category_used_bird or {}
    category_retailer_used_bird = category_retailer_used_bird or {}
    category_usage = [
        InventoryCategoryUsageRead(
            category_id=category.id,
            category_name=category.name,
            available_quantity=available_quantity,
            used_quantity=category_used.get((item.id, category.id), ZERO),
            retailer_used_quantity=category_retailer_used.get((item.id, category.id), ZERO),
            used_bird_count=category_used_bird.get((item.id, category.id), 0),
            retailer_used_bird_count=category_retailer_used_bird.get((item.id, category.id), 0),
        )
        for category in base.categories
    ]

    # ponytail: if an item has categories, its total used quantity is strictly the sum of category usage.
    if category_usage:
        used_quantity = sum((cat.used_quantity for cat in category_usage), ZERO)
        retailer_used_quantity = sum((cat.retailer_used_quantity for cat in category_usage), ZERO)
        used_bird_count = sum(cat.used_bird_count for cat in category_usage)
        retailer_used_bird_count = sum(cat.retailer_used_bird_count for cat in category_usage)

    return InventoryItemStockRead(
        **base.model_dump(),
        allocated=allocation is not None,
        allocation_active=bool(allocation and allocation.is_active and item.is_active),
        allocation_sort_order=allocation.sort_order if allocation is not None else item.sort_order,
        available_quantity=available_quantity,
        added_quantity=added_quantity,
        used_quantity=used_quantity,
        transfer_stock=transfer_stock,
        retailer_used_quantity=retailer_used_quantity,
        available_bird_count=available_bird_count,
        added_bird_count=added_bird_count,
        used_bird_count=used_bird_count,
        transfer_bird_count=transfer_bird_count,
        retailer_used_bird_count=retailer_used_bird_count,
        stock_last_updated_at=stock_last_updated_at,
        category_usage=category_usage,
    )


async def get_inventory_summary(
    db: AsyncSession,
    shop: Shop,
    *,
    include_unallocated: bool = False,
    active_allocations_only: bool = False,
) -> InventorySummaryRead:
    allocation_query = select(ShopInventoryAllocation).where(
        ShopInventoryAllocation.shop_id == shop.id
    )
    allocations = (await db.scalars(allocation_query)).all()
    allocations_by_item_id = {
        allocation.inventory_item_id: allocation for allocation in allocations
    }
    scoped_item_ids = list(allocations_by_item_id)

    if active_allocations_only:
        scoped_item_ids = [
            allocation.inventory_item_id for allocation in allocations if allocation.is_active
        ]

    if not include_unallocated and not scoped_item_ids:
        return InventorySummaryRead(
            shop_id=shop.id,
            shop_name=shop.name,
            items=[],
            categories=[],
            total_transfer_stock=ZERO,
            total_used_stock=ZERO,
            total_retailer_used_stock=ZERO,
            total_transfer_bird_count=0,
            total_used_bird_count=0,
            total_retailer_used_bird_count=0,
        )

    item_query = select(InventoryItem).options(
        selectinload(InventoryItem.category_links).selectinload(InventoryItemCategory.category)
    )

    if include_unallocated:
        pass
    else:
        item_query = item_query.where(InventoryItem.id.in_(scoped_item_ids))
    if active_allocations_only:
        item_query = item_query.where(InventoryItem.is_active.is_(True))

    items = (
        await db.scalars(
            item_query.order_by(
                InventoryItem.sort_order, func.lower(InventoryItem.name), InventoryItem.id
            )
        )
    ).all()
    item_ids = [item.id for item in items]
    (
        added,
        used_alltime,
        _,
        transferred_alltime,
        added_bird,
        used_alltime_bird,
        _,
        transferred_alltime_bird,
    ) = await _movement_totals(db, shop.id, item_ids)
    (
        _,
        used_today,
        category_used_today,
        transferred_today,
        _,
        used_today_bird,
        category_used_today_bird,
        transferred_today_bird,
    ) = await _movement_totals(db, shop.id, item_ids, used_since=date.today())
    (
        retailer_used_alltime,
        category_retailer_used_alltime,
        retailer_used_alltime_bird,
        category_retailer_used_alltime_bird,
    ) = await _retailer_usage_totals(db, shop.id, item_ids)
    (
        retailer_used_today,
        category_retailer_used_today,
        retailer_used_today_bird,
        category_retailer_used_today_bird,
    ) = await _retailer_usage_totals(db, shop.id, item_ids, used_since=date.today())
    stock_last_updated = await _stock_last_updated_at_by_item_id(db, shop.id, item_ids)
    stock_items = [
        _stock_item_from_inventory_item(
            item,
            allocation=allocations_by_item_id.get(item.id),
            added_quantity=added.get(item.id, ZERO),
            used_quantity=used_today.get(item.id, ZERO),
            available_quantity=added.get(item.id, ZERO)
            - used_alltime.get(item.id, ZERO)
            - transferred_alltime.get(item.id, ZERO)
            - retailer_used_alltime.get(item.id, ZERO),
            transfer_stock=transferred_today.get(item.id, ZERO),
            retailer_used_quantity=retailer_used_today.get(item.id, ZERO),
            added_bird_count=added_bird.get(item.id, 0),
            used_bird_count=used_today_bird.get(item.id, 0),
            available_bird_count=_clamp_available_bird_count(
                added_bird.get(item.id, 0)
                - used_alltime_bird.get(item.id, 0)
                - transferred_alltime_bird.get(item.id, 0)
                - retailer_used_alltime_bird.get(item.id, 0)
            ),
            transfer_bird_count=transferred_today_bird.get(item.id, 0),
            retailer_used_bird_count=retailer_used_today_bird.get(item.id, 0),
            category_used=category_used_today,
            category_retailer_used=category_retailer_used_today,
            category_used_bird=category_used_today_bird,
            category_retailer_used_bird=category_retailer_used_today_bird,
            stock_last_updated_at=stock_last_updated.get(item.id),
        )
        for item in items
    ]
    stock_items.sort(
        key=lambda item: (
            0 if item.allocated else 1,
            item.allocation_sort_order,
            item.name.lower(),
            str(item.id),
        )
    )

    category_totals: dict[UUID, InventoryCategoryUsageRead] = {}
    for stock_item in stock_items:
        if active_allocations_only and not stock_item.allocation_active:
            continue
        if not include_unallocated and not stock_item.allocated:
            continue
        for category in stock_item.category_usage:
            existing = category_totals.get(category.category_id)
            if existing is None:
                category_totals[category.category_id] = InventoryCategoryUsageRead(
                    category_id=category.category_id,
                    category_name=category.category_name,
                    available_quantity=category.available_quantity,
                    used_quantity=category.used_quantity,
                    retailer_used_quantity=category.retailer_used_quantity,
                    used_bird_count=category.used_bird_count,
                    retailer_used_bird_count=category.retailer_used_bird_count,
                )
            else:
                existing.available_quantity += category.available_quantity
                existing.used_quantity += category.used_quantity
                existing.retailer_used_quantity += category.retailer_used_quantity
                existing.used_bird_count += category.used_bird_count
                existing.retailer_used_bird_count += category.retailer_used_bird_count

    total_transfer_stock = ZERO
    total_used_stock = ZERO
    total_retailer_used_stock = ZERO
    total_transfer_bird_count = 0
    total_used_bird_count = 0
    total_retailer_used_bird_count = 0
    for stock_item in stock_items:
        if active_allocations_only and not stock_item.allocation_active:
            continue
        if not include_unallocated and not stock_item.allocated:
            continue
        total_transfer_stock += stock_item.transfer_stock
        total_used_stock += stock_item.used_quantity
        total_retailer_used_stock += stock_item.retailer_used_quantity
        total_transfer_bird_count += stock_item.transfer_bird_count
        total_used_bird_count += stock_item.used_bird_count
        total_retailer_used_bird_count += stock_item.retailer_used_bird_count

    return InventorySummaryRead(
        shop_id=shop.id,
        shop_name=shop.name,
        items=stock_items,
        categories=sorted(
            category_totals.values(),
            key=lambda category: (category.category_name.lower(), str(category.category_id)),
        ),
        total_transfer_stock=total_transfer_stock,
        total_used_stock=total_used_stock,
        total_retailer_used_stock=total_retailer_used_stock,
        total_transfer_bird_count=total_transfer_bird_count,
        total_used_bird_count=total_used_bird_count,
        total_retailer_used_bird_count=total_retailer_used_bird_count,
    )


async def list_inventory_stock_rows(
    db: AsyncSession,
    shop: Shop,
    *,
    q: str | None = None,
    active: bool | None = None,
    include_unallocated: bool = False,
    active_allocations_only: bool = False,
    limit: int = 50,
    cursor_sort_order: int | None = None,
    cursor_name: str | None = None,
    cursor_id: UUID | None = None,
) -> InventoryStockRowsPage:
    allocation_join = and_(
        ShopInventoryAllocation.shop_id == shop.id,
        ShopInventoryAllocation.inventory_item_id == InventoryItem.id,
    )
    sort_order_expr = func.coalesce(
        ShopInventoryAllocation.sort_order,
        InventoryItem.sort_order,
    )
    query = (
        select(InventoryItem, ShopInventoryAllocation)
        .outerjoin(ShopInventoryAllocation, allocation_join)
        .options(
            selectinload(InventoryItem.category_links).selectinload(InventoryItemCategory.category)
        )
    )

    if not include_unallocated:
        query = query.where(ShopInventoryAllocation.id.is_not(None))
    if active_allocations_only:
        query = query.where(
            ShopInventoryAllocation.is_active.is_(True),
            InventoryItem.is_active.is_(True),
        )
    if active is not None:
        query = query.where(InventoryItem.is_active.is_(active))

    search = q.strip() if q else ""
    if search:
        like_search = f"%{search.lower()}%"
        query = query.where(
            or_(
                func.lower(InventoryItem.name).like(like_search),
                func.lower(InventoryItem.tamil_name).like(like_search),
            )
        )

    cursor_condition = _inventory_stock_cursor_filter(
        sort_order_expr,
        cursor_sort_order,
        cursor_name,
        cursor_id,
    )
    if cursor_condition is not None:
        query = query.where(cursor_condition)

    rows = (
        await db.execute(
            query.order_by(
                sort_order_expr,
                func.lower(InventoryItem.name),
                InventoryItem.id,
            ).limit(limit + 1)
        )
    ).all()
    page_rows = rows[:limit]
    has_more = len(rows) > limit
    item_ids = [row[0].id for row in page_rows]
    # Fetch all-time totals for correct available_quantity, and today-only
    # totals for the displayed used_quantity (which resets each day).
    (
        added,
        used_alltime,
        _,
        transferred_alltime,
        added_bird,
        used_alltime_bird,
        _,
        transferred_alltime_bird,
    ) = await _movement_totals(db, shop.id, item_ids)
    (
        _,
        used_today,
        category_used_today,
        transferred_today,
        _,
        used_today_bird,
        category_used_today_bird,
        transferred_today_bird,
    ) = await _movement_totals(db, shop.id, item_ids, used_since=date.today())
    (
        retailer_used_alltime,
        category_retailer_used_alltime,
        retailer_used_alltime_bird,
        category_retailer_used_alltime_bird,
    ) = await _retailer_usage_totals(db, shop.id, item_ids)
    (
        retailer_used_today,
        category_retailer_used_today,
        retailer_used_today_bird,
        category_retailer_used_today_bird,
    ) = await _retailer_usage_totals(db, shop.id, item_ids, used_since=date.today())

    stock_last_updated = await _stock_last_updated_at_by_item_id(db, shop.id, item_ids)

    stock_items = [
        _stock_item_from_inventory_item(
            item,
            allocation=allocation,
            added_quantity=added.get(item.id, ZERO),
            # Display: today's usage (resets daily)
            used_quantity=used_today.get(item.id, ZERO),
            # Availability: reduced by all-time outflows
            available_quantity=added.get(item.id, ZERO)
            - used_alltime.get(item.id, ZERO)
            - transferred_alltime.get(item.id, ZERO)
            - retailer_used_alltime.get(item.id, ZERO),
            transfer_stock=transferred_today.get(item.id, ZERO),
            retailer_used_quantity=retailer_used_today.get(item.id, ZERO),
            added_bird_count=added_bird.get(item.id, 0),
            used_bird_count=used_today_bird.get(item.id, 0),
            available_bird_count=_clamp_available_bird_count(
                added_bird.get(item.id, 0)
                - used_alltime_bird.get(item.id, 0)
                - transferred_alltime_bird.get(item.id, 0)
                - retailer_used_alltime_bird.get(item.id, 0)
            ),
            transfer_bird_count=transferred_today_bird.get(item.id, 0),
            retailer_used_bird_count=retailer_used_today_bird.get(item.id, 0),
            category_used=category_used_today,
            category_retailer_used=category_retailer_used_today,
            category_used_bird=category_used_today_bird,
            category_retailer_used_bird=category_retailer_used_today_bird,
            stock_last_updated_at=stock_last_updated.get(item.id),
        )
        for item, allocation in page_rows
    ]

    next_cursor_sort_order = next_cursor_name = next_cursor_id = None
    if has_more and page_rows:
        last_item, last_allocation = page_rows[-1]
        next_cursor_sort_order = (
            last_allocation.sort_order if last_allocation is not None else last_item.sort_order
        )
        next_cursor_name = last_item.name.lower()
        next_cursor_id = last_item.id

    total_transfer_stock = ZERO
    total_used_stock = ZERO
    total_retailer_used_stock = ZERO
    total_transfer_bird_count = 0
    total_used_bird_count = 0
    total_retailer_used_bird_count = 0
    if cursor_id is None:
        summary = await get_inventory_summary(
            db, shop, include_unallocated=False, active_allocations_only=active_allocations_only
        )
        total_transfer_stock = summary.total_transfer_stock
        total_used_stock = summary.total_used_stock
        total_retailer_used_stock = summary.total_retailer_used_stock
        total_transfer_bird_count = summary.total_transfer_bird_count
        total_used_bird_count = summary.total_used_bird_count
        total_retailer_used_bird_count = summary.total_retailer_used_bird_count

    return InventoryStockRowsPage(
        shop_id=shop.id,
        shop_name=shop.name,
        items=stock_items,
        limit=limit,
        has_more=has_more,
        next_cursor_sort_order=next_cursor_sort_order,
        next_cursor_name=next_cursor_name,
        next_cursor_id=next_cursor_id,
        total_transfer_stock=total_transfer_stock,
        total_used_stock=total_used_stock,
        total_retailer_used_stock=total_retailer_used_stock,
        total_transfer_bird_count=total_transfer_bird_count,
        total_used_bird_count=total_used_bird_count,
        total_retailer_used_bird_count=total_retailer_used_bird_count,
    )


async def allocate_shop_inventory_items(
    db: AsyncSession,
    shop: Shop,
    item_ids: list[UUID],
) -> ShopInventoryAllocationBulkRead:
    unique_item_ids = list(dict.fromkeys(item_ids))
    items = (
        await db.scalars(select(InventoryItem).where(InventoryItem.id.in_(unique_item_ids)))
    ).all()
    items_by_id = {item.id: item for item in items}
    for item_id in unique_item_ids:
        item = items_by_id.get(item_id)
        if item is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found"
            )
        if not item.is_active:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Inactive inventory items cannot be allocated to a shop",
            )
    existing_item_ids = set(
        (
            await db.scalars(
                select(ShopInventoryAllocation.inventory_item_id).where(
                    ShopInventoryAllocation.shop_id == shop.id,
                    ShopInventoryAllocation.inventory_item_id.in_(unique_item_ids),
                )
            )
        ).all()
    )
    new_item_ids = [item_id for item_id in unique_item_ids if item_id not in existing_item_ids]
    allocated_count = len(new_item_ids)
    for item_id in new_item_ids:
        db.add(ShopInventoryAllocation(shop_id=shop.id, inventory_item_id=item_id))
    if new_item_ids:
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Inventory allocation already exists",
            ) from None
    return ShopInventoryAllocationBulkRead(
        item_ids=unique_item_ids,
        allocated_count=allocated_count,
        already_allocated_count=len(unique_item_ids) - allocated_count,
    )


async def update_shop_inventory_allocation(
    db: AsyncSession,
    shop: Shop,
    item_id: UUID,
    *,
    is_active: bool | None = None,
    sort_order: int | None = None,
) -> InventoryItemStockRead:
    allocation = await db.scalar(
        select(ShopInventoryAllocation)
        .where(
            ShopInventoryAllocation.shop_id == shop.id,
            ShopInventoryAllocation.inventory_item_id == item_id,
        )
        .with_for_update()
    )
    if allocation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inventory allocation not found"
        )
    if is_active is not None:
        allocation.is_active = is_active
    if sort_order is not None:
        allocation.sort_order = sort_order
    await db.flush()
    item = await db.scalar(
        select(InventoryItem)
        .where(InventoryItem.id == item_id)
        .options(
            selectinload(InventoryItem.category_links).selectinload(InventoryItemCategory.category)
        )
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found"
        )
    stock_item = await _stock_item_for_shop_inventory_item(db, shop, item, allocation)
    await db.commit()
    return stock_item


async def _get_allocated_inventory_item_for_shop(
    db: AsyncSession,
    shop: Shop,
    item_id: UUID,
) -> tuple[InventoryItem, ShopInventoryAllocation]:
    allocation = await db.scalar(
        select(ShopInventoryAllocation)
        .where(
            ShopInventoryAllocation.shop_id == shop.id,
            ShopInventoryAllocation.inventory_item_id == item_id,
        )
        .with_for_update()
    )
    if allocation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inventory item is not allocated to this shop",
        )
    if not allocation.is_active:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Inventory allocation is inactive",
        )
    item = await db.scalar(
        select(InventoryItem)
        .where(InventoryItem.id == item_id)
        .options(
            selectinload(InventoryItem.category_links).selectinload(InventoryItemCategory.category)
        )
        .with_for_update()
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found"
        )
    if not item.is_active:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Inventory item is inactive",
        )
    return item, allocation


async def _available_quantity_at(
    db: AsyncSession,
    shop_id: UUID,
    item_id: UUID,
    *,
    as_of: datetime,
) -> Decimal:
    added, used, _, transferred, *_bird = await _movement_totals(
        db, shop_id, [item_id], as_of=as_of
    )
    retailer_used, _, *_retailer_bird = await _retailer_usage_totals(
        db, shop_id, [item_id], as_of=as_of
    )
    return (
        added.get(item_id, ZERO)
        - used.get(item_id, ZERO)
        - transferred.get(item_id, ZERO)
        - retailer_used.get(item_id, ZERO)
    )


async def _quantity_availability_for_transaction(
    db: AsyncSession,
    shop_id: UUID,
    item_id: UUID,
    *,
    raw_occurred_at: datetime | None,
    occurred_at: datetime,
) -> Decimal:
    """Match shop stock display: all-time totals unless the client backdated the transaction."""
    if raw_occurred_at is None:
        added, used, _, transferred, *_bird = await _movement_totals(db, shop_id, [item_id])
        retailer_used, _, *_retailer_bird = await _retailer_usage_totals(db, shop_id, [item_id])
    else:
        added, used, _, transferred, *_bird = await _movement_totals(
            db, shop_id, [item_id], as_of=occurred_at
        )
        retailer_used, _, *_retailer_bird = await _retailer_usage_totals(
            db, shop_id, [item_id], as_of=occurred_at
        )
    return (
        added.get(item_id, ZERO)
        - used.get(item_id, ZERO)
        - transferred.get(item_id, ZERO)
        - retailer_used.get(item_id, ZERO)
    )


async def _bird_availability_for_transaction(
    db: AsyncSession,
    shop_id: UUID,
    item_id: UUID,
    *,
    raw_occurred_at: datetime | None,
    occurred_at: datetime,
) -> tuple[int, int]:
    """Return (added_bird_count, available_bird_count) aligned with shop stock reads."""
    if raw_occurred_at is None:
        totals = await _movement_totals(db, shop_id, [item_id])
        retailer_totals = await _retailer_usage_totals(db, shop_id, [item_id])
    else:
        totals = await _movement_totals(db, shop_id, [item_id], as_of=occurred_at)
        retailer_totals = await _retailer_usage_totals(db, shop_id, [item_id], as_of=occurred_at)
    added_bird = totals[4].get(item_id, 0)
    used_bird = totals[5].get(item_id, 0)
    transferred_bird = totals[7].get(item_id, 0)
    retailer_used_bird = retailer_totals[2].get(item_id, 0)
    available_bird = _clamp_available_bird_count(
        added_bird - used_bird - transferred_bird - retailer_used_bird
    )
    return added_bird, available_bird


def _clamp_available_bird_count(value: int) -> int:
    return max(0, value)


async def _added_bird_count_at(
    db: AsyncSession,
    shop_id: UUID,
    item_id: UUID,
    *,
    as_of: datetime,
) -> int:
    totals = await _movement_totals(db, shop_id, [item_id], as_of=as_of)
    added_bird = totals[4]
    return added_bird.get(item_id, 0)


async def _available_bird_count_at(
    db: AsyncSession,
    shop_id: UUID,
    item_id: UUID,
    *,
    as_of: datetime,
) -> int:
    (
        _added,
        used,
        _,
        transferred,
        added_bird,
        used_bird,
        _,
        transferred_bird,
    ) = await _movement_totals(db, shop_id, [item_id], as_of=as_of)
    retailer_used_bird, _, *_ = await _retailer_usage_totals(db, shop_id, [item_id], as_of=as_of)
    return _clamp_available_bird_count(
        added_bird.get(item_id, 0)
        - used_bird.get(item_id, 0)
        - transferred_bird.get(item_id, 0)
        - retailer_used_bird.get(item_id, 0)
    )


def _validate_bird_count_ceiling(
    item: InventoryItem,
    bird_count: int,
    *,
    available_bird_count: int,
    added_bird_count: int,
) -> None:
    if item.base_unit != BaseUnit.KG or bird_count <= 0:
        return
    # Historical ADD rows have bird_count=0 until stock is received with birds.
    if added_bird_count <= 0:
        return
    if bird_count > available_bird_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Bird count exceeds available bird count "
                f"({bird_count} requested, {available_bird_count} available)"
            ),
        )


async def _available_quantity_for_item(db: AsyncSession, shop_id: UUID, item_id: UUID) -> Decimal:
    return await _available_quantity_at(db, shop_id, item_id, as_of=datetime.now(UTC))


async def _stock_item_for_shop_inventory_item(
    db: AsyncSession,
    shop: Shop,
    item: InventoryItem,
    allocation: ShopInventoryAllocation,
    *,
    used_since: date | None = None,
) -> InventoryItemStockRead:
    """Return stock data for a single item.

    When ``used_since`` is set the displayed ``used_quantity`` is scoped to
    movements on or after that date, while ``available_quantity`` is always
    computed from all-time totals to stay correct for capacity checks.
    """
    (
        added,
        used_alltime,
        category_used_alltime,
        transferred_alltime,
        added_bird,
        used_alltime_bird,
        category_used_alltime_bird,
        transferred_alltime_bird,
    ) = await _movement_totals(db, shop.id, [item.id])
    (
        retailer_used_alltime,
        category_retailer_used_alltime,
        retailer_used_alltime_bird,
        category_retailer_used_alltime_bird,
    ) = await _retailer_usage_totals(db, shop.id, [item.id])
    if used_since is not None:
        (
            _,
            used_display,
            category_used_display,
            transferred_display,
            _,
            used_display_bird,
            category_used_display_bird,
            transferred_display_bird,
        ) = await _movement_totals(db, shop.id, [item.id], used_since=used_since)
        (
            retailer_used_display,
            category_retailer_used_display,
            retailer_used_display_bird,
            category_retailer_used_display_bird,
        ) = await _retailer_usage_totals(db, shop.id, [item.id], used_since=used_since)
    else:
        used_display = used_alltime
        category_used_display = category_used_alltime
        transferred_display = transferred_alltime
        retailer_used_display = retailer_used_alltime
        category_retailer_used_display = category_retailer_used_alltime
        used_display_bird = used_alltime_bird
        category_used_display_bird = category_used_alltime_bird
        transferred_display_bird = transferred_alltime_bird
        retailer_used_display_bird = retailer_used_alltime_bird
        category_retailer_used_display_bird = category_retailer_used_alltime_bird
    stock_last_updated = await _stock_last_updated_at_by_item_id(db, shop.id, [item.id])
    return _stock_item_from_inventory_item(
        item,
        allocation=allocation,
        added_quantity=added.get(item.id, ZERO),
        used_quantity=used_display.get(item.id, ZERO),
        available_quantity=added.get(item.id, ZERO)
        - used_alltime.get(item.id, ZERO)
        - transferred_alltime.get(item.id, ZERO)
        - retailer_used_alltime.get(item.id, ZERO),
        transfer_stock=transferred_display.get(item.id, ZERO),
        retailer_used_quantity=retailer_used_display.get(item.id, ZERO),
        added_bird_count=added_bird.get(item.id, 0),
        used_bird_count=used_display_bird.get(item.id, 0),
        available_bird_count=_clamp_available_bird_count(
            added_bird.get(item.id, 0)
            - used_alltime_bird.get(item.id, 0)
            - transferred_alltime_bird.get(item.id, 0)
            - retailer_used_alltime_bird.get(item.id, 0)
        ),
        transfer_bird_count=transferred_display_bird.get(item.id, 0),
        retailer_used_bird_count=retailer_used_display_bird.get(item.id, 0),
        category_used=category_used_display,
        category_retailer_used=category_retailer_used_display,
        category_used_bird=category_used_display_bird,
        category_retailer_used_bird=category_retailer_used_display_bird,
        stock_last_updated_at=stock_last_updated.get(item.id),
    )


def _movement_to_read(movement: InventoryMovement) -> InventoryMovementRead:
    item = movement.item
    category = movement.category
    shop = movement.shop
    return InventoryMovementRead(
        id=movement.id,
        shop_id=movement.shop_id,
        shop_name=shop.name if shop is not None else None,
        inventory_item_id=movement.inventory_item_id,
        inventory_item_name=item.name if item is not None else "",
        inventory_item_tamil_name=item.tamil_name if item is not None else None,
        category_id=movement.category_id,
        category_name=category.name if category is not None else None,
        movement_type=movement.movement_type,
        quantity=movement.quantity,
        bird_count=movement.bird_count,
        unit=item.base_unit if item is not None else BaseUnit.KG,
        driver_name=movement.driver_name,
        vehicle_number=movement.vehicle_number,
        occurred_at=movement.occurred_at,
        created_at=movement.created_at,
    )


async def list_inventory_movements(
    db: AsyncSession,
    *,
    shop_id: UUID | None = None,
    item_id: UUID | None = None,
    category_id: UUID | None = None,
    reference_date: date | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
    limit: int = 100,
) -> InventoryMovementPage:
    query = select(InventoryMovement).options(
        selectinload(InventoryMovement.shop),
        selectinload(InventoryMovement.item),
        selectinload(InventoryMovement.category),
    )
    if shop_id is not None:
        query = query.where(InventoryMovement.shop_id == shop_id)
    if item_id is not None:
        query = query.where(InventoryMovement.inventory_item_id == item_id)
    if category_id is not None:
        query = query.where(InventoryMovement.category_id == category_id)
    if range_start_date is not None or range_end_date is not None:
        if range_start_date is not None:
            query = query.where(
                InventoryMovement.occurred_at
                >= ist_midnight(range_start_date)
            )
        if range_end_date is not None:
            query = query.where(
                InventoryMovement.occurred_at
                < ist_midnight(range_end_date + timedelta(days=1))
            )
    elif reference_date is not None:
        query = query.where(
            InventoryMovement.occurred_at >= ist_midnight(reference_date),
            InventoryMovement.occurred_at
            < ist_midnight(reference_date + timedelta(days=1)),
        )
    rows = (
        await db.scalars(
            query.order_by(InventoryMovement.occurred_at.desc(), InventoryMovement.id.desc()).limit(
                limit + 1
            )
        )
    ).all()
    page_rows = rows[:limit]
    return InventoryMovementPage(
        items=[_movement_to_read(movement) for movement in page_rows],
        limit=limit,
        has_more=len(rows) > limit,
    )


async def list_inventory_transfers(
    db: AsyncSession,
    *,
    shop_id: UUID | None = None,
    item_id: UUID | None = None,
    reference_date: date | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
    limit: int = 100,
) -> InventoryTransferPage:
    query = select(InventoryTransfer).options(
        selectinload(InventoryTransfer.source_shop),
        selectinload(InventoryTransfer.transfer_shop),
        selectinload(InventoryTransfer.inventory_item),
    )
    if shop_id is not None:
        query = query.where(InventoryTransfer.source_shop_id == shop_id)
    if item_id is not None:
        query = query.where(InventoryTransfer.inventory_item_id == item_id)
    if range_start_date is not None or range_end_date is not None:
        if range_start_date is not None:
            query = query.where(
                InventoryTransfer.occurred_at
                >= ist_midnight(range_start_date)
            )
        if range_end_date is not None:
            query = query.where(
                InventoryTransfer.occurred_at
                < ist_midnight(range_end_date + timedelta(days=1))
            )
    elif reference_date is not None:
        query = query.where(
            InventoryTransfer.occurred_at >= ist_midnight(reference_date),
            InventoryTransfer.occurred_at
            < ist_midnight(reference_date + timedelta(days=1)),
        )
    rows = (
        await db.scalars(
            query.order_by(InventoryTransfer.occurred_at.desc(), InventoryTransfer.id.desc()).limit(
                limit + 1
            )
        )
    ).all()
    page_rows = rows[:limit]

    items = []
    for transfer in page_rows:
        read = InventoryTransferRead.model_validate(transfer)
        read.source_shop_name = transfer.source_shop.name if transfer.source_shop else None
        read.transfer_shop_name = transfer.transfer_shop.name if transfer.transfer_shop else None
        read.inventory_item_name = transfer.inventory_item.name if transfer.inventory_item else None
        read.inventory_item_tamil_name = (
            transfer.inventory_item.tamil_name if transfer.inventory_item else None
        )
        items.append(read)

    return InventoryTransferPage(
        items=items,
        limit=limit,
        has_more=len(rows) > limit,
    )


async def add_shop_inventory_stock(
    db: AsyncSession,
    shop: Shop,
    item_id: UUID,
    payload: InventoryAddRequest,
    *,
    actor: User | None = None,
    include_summary: bool = False,
) -> InventoryMovementCreateResult:
    item, allocation = await _get_allocated_inventory_item_for_shop(db, shop, item_id)
    quantity = _normalize_quantity(item.base_unit, payload.quantity)
    occurred_at = await _prepare_occurred_at(db, actor=actor, shop=shop, raw=payload.occurred_at)
    movement = InventoryMovement(
        shop_id=shop.id,
        inventory_item_id=item.id,
        movement_type=InventoryMovementType.ADD,
        quantity=quantity,
        bird_count=payload.bird_count,
        driver_name=payload.driver_name.strip(),
        vehicle_number=payload.vehicle_number.strip(),
        occurred_at=occurred_at,
    )
    db.add(movement)
    await db.commit()
    await db.refresh(movement)
    movement = await db.scalar(
        select(InventoryMovement)
        .where(InventoryMovement.id == movement.id)
        .options(
            selectinload(InventoryMovement.shop),
            selectinload(InventoryMovement.item),
            selectinload(InventoryMovement.category),
        )
    )
    summary = None
    if include_summary:
        summary = await get_inventory_summary(
            db, shop, include_unallocated=False, active_allocations_only=True
        )
        stock_item = next(item for item in summary.items if item.id == item_id)
    else:
        stock_item = await _stock_item_for_shop_inventory_item(
            db, shop, item, allocation, used_since=date.today()
        )
    return InventoryMovementCreateResult(
        movement=_movement_to_read(movement),
        item=stock_item,
        summary=summary,
    )


async def use_shop_inventory_stock(
    db: AsyncSession,
    shop: Shop,
    item_id: UUID,
    payload: InventoryUseRequest,
    *,
    actor: User | None = None,
    include_summary: bool = False,
) -> InventoryMovementCreateResult:
    item, allocation = await _get_allocated_inventory_item_for_shop(db, shop, item_id)
    quantity = _normalize_quantity(item.base_unit, payload.quantity)
    occurred_at = await _prepare_occurred_at(db, actor=actor, shop=shop, raw=payload.occurred_at)
    category_ids = {link.category_id for link in item.category_links}
    if category_ids and payload.category_id not in category_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Inventory category is not linked to this item",
        )
    if not category_ids and payload.category_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Inventory category is not linked to this item",
        )
    available_quantity = await _quantity_availability_for_transaction(
        db,
        shop.id,
        item.id,
        raw_occurred_at=payload.occurred_at,
        occurred_at=occurred_at,
    )
    if _quantity_exceeds_available(quantity, available_quantity):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Inventory use exceeds available item quantity",
        )
    added_bird_count, available_bird_count = await _bird_availability_for_transaction(
        db,
        shop.id,
        item.id,
        raw_occurred_at=payload.occurred_at,
        occurred_at=occurred_at,
    )
    _validate_bird_count_ceiling(
        item,
        payload.bird_count,
        available_bird_count=available_bird_count,
        added_bird_count=added_bird_count,
    )
    movement = InventoryMovement(
        shop_id=shop.id,
        inventory_item_id=item.id,
        category_id=payload.category_id,
        movement_type=InventoryMovementType.USE,
        quantity=quantity,
        bird_count=payload.bird_count,
        occurred_at=occurred_at,
    )
    db.add(movement)
    await db.commit()
    await db.refresh(movement)
    movement = await db.scalar(
        select(InventoryMovement)
        .where(InventoryMovement.id == movement.id)
        .options(
            selectinload(InventoryMovement.shop),
            selectinload(InventoryMovement.item),
            selectinload(InventoryMovement.category),
        )
    )
    summary = None
    if include_summary:
        summary = await get_inventory_summary(
            db, shop, include_unallocated=False, active_allocations_only=True
        )
        stock_item = next(item for item in summary.items if item.id == item_id)
    else:
        stock_item = await _stock_item_for_shop_inventory_item(
            db, shop, item, allocation, used_since=date.today()
        )
    return InventoryMovementCreateResult(
        movement=_movement_to_read(movement),
        item=stock_item,
        summary=summary,
    )


async def use_shop_inventory_stock_split(
    db: AsyncSession,
    shop: Shop,
    item_id: UUID,
    payload: InventoryUseSplitRequest,
    *,
    actor: User | None = None,
    include_summary: bool = False,
) -> InventoryMovementSplitCreateResult:
    item, allocation = await _get_allocated_inventory_item_for_shop(db, shop, item_id)
    total_quantity = _normalize_quantity(item.base_unit, payload.total_quantity)
    occurred_at = await _prepare_occurred_at(db, actor=actor, shop=shop, raw=payload.occurred_at)
    linked_category_ids = {link.category_id for link in item.category_links}
    split_quantities: dict[UUID, Decimal] = {}
    split_bird_counts: dict[UUID, int] = {}
    for line in payload.categories:
        if line.category_id not in linked_category_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Inventory category is not linked to this item",
            )
        quantity = _normalize_nonnegative_quantity(item.base_unit, line.quantity)
        split_quantities[line.category_id] = split_quantities.get(line.category_id, ZERO) + quantity
        split_bird_counts[line.category_id] = (
            split_bird_counts.get(line.category_id, 0) + line.bird_count
        )

    split_quantities = {
        category_id: quantity
        for category_id, quantity in split_quantities.items()
        if quantity > ZERO
    }
    split_bird_counts = {
        category_id: bird_count
        for category_id, bird_count in split_bird_counts.items()
        if category_id in split_quantities
    }
    split_total = sum(split_quantities.values(), ZERO).quantize(THREE_DECIMALS)
    if not split_quantities or split_total != total_quantity:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Category split total must match the inventory use quantity",
        )

    available_quantity = await _quantity_availability_for_transaction(
        db,
        shop.id,
        item.id,
        raw_occurred_at=payload.occurred_at,
        occurred_at=occurred_at,
    )
    if _quantity_exceeds_available(total_quantity, available_quantity):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Inventory use exceeds available item quantity",
        )
    total_bird_count = sum(split_bird_counts.values())
    added_bird_count, available_bird_count = await _bird_availability_for_transaction(
        db,
        shop.id,
        item.id,
        raw_occurred_at=payload.occurred_at,
        occurred_at=occurred_at,
    )
    _validate_bird_count_ceiling(
        item,
        total_bird_count,
        available_bird_count=available_bird_count,
        added_bird_count=added_bird_count,
    )

    movements = [
        InventoryMovement(
            shop_id=shop.id,
            inventory_item_id=item.id,
            category_id=category_id,
            movement_type=InventoryMovementType.USE,
            quantity=quantity,
            bird_count=split_bird_counts.get(category_id, 0),
            occurred_at=occurred_at,
        )
        for category_id, quantity in split_quantities.items()
    ]
    for movement in movements:
        db.add(movement)
    await db.flush()
    movement_ids = [movement.id for movement in movements]
    await db.commit()
    saved_movements = (
        await db.scalars(
            select(InventoryMovement)
            .where(InventoryMovement.id.in_(movement_ids))
            .options(
                selectinload(InventoryMovement.shop),
                selectinload(InventoryMovement.item),
                selectinload(InventoryMovement.category),
            )
            .order_by(InventoryMovement.occurred_at, InventoryMovement.id)
        )
    ).all()
    summary = None
    if include_summary:
        summary = await get_inventory_summary(
            db, shop, include_unallocated=False, active_allocations_only=True
        )
        stock_item = next(item for item in summary.items if item.id == item_id)
    else:
        stock_item = await _stock_item_for_shop_inventory_item(
            db, shop, item, allocation, used_since=date.today()
        )
    return InventoryMovementSplitCreateResult(
        movements=[_movement_to_read(movement) for movement in saved_movements],
        item=stock_item,
        summary=summary,
    )


def _append_kg_neutral_available_bird_movements(
    movements_added: list[InventoryMovement],
    *,
    shop_id: UUID,
    item_id: UUID,
    delta_birds: int,
    occurred_at: datetime,
) -> None:
    """Adjust available birds without changing kg totals or today's used kg."""
    if delta_birds == 0:
        return
    trace = THREE_DECIMALS
    if delta_birds > 0:
        movements_added.append(
            InventoryMovement(
                shop_id=shop_id,
                inventory_item_id=item_id,
                movement_type=InventoryMovementType.ADD,
                quantity=trace,
                bird_count=delta_birds,
                occurred_at=occurred_at,
            )
        )
        movements_added.append(
            InventoryMovement(
                shop_id=shop_id,
                inventory_item_id=item_id,
                movement_type=InventoryMovementType.ADD,
                quantity=-trace,
                bird_count=0,
                occurred_at=occurred_at,
            )
        )
        return

    abs_delta = abs(delta_birds)
    movements_added.append(
        InventoryMovement(
            shop_id=shop_id,
            inventory_item_id=item_id,
            movement_type=InventoryMovementType.USE,
            quantity=trace,
            bird_count=abs_delta,
            occurred_at=occurred_at,
        )
    )
    movements_added.append(
        InventoryMovement(
            shop_id=shop_id,
            inventory_item_id=item_id,
            movement_type=InventoryMovementType.USE,
            quantity=-trace,
            bird_count=0,
            occurred_at=occurred_at,
        )
    )


def _append_kg_neutral_used_bird_movements(
    movements_added: list[InventoryMovement],
    *,
    shop_id: UUID,
    item_id: UUID,
    category_id: UUID | None,
    delta_birds: int,
    occurred_at: datetime,
) -> None:
    """Adjust today's used birds without changing today's used kg."""
    if delta_birds == 0:
        return
    trace = THREE_DECIMALS
    bird_delta = delta_birds if delta_birds > 0 else -abs(delta_birds)
    movements_added.append(
        InventoryMovement(
            shop_id=shop_id,
            inventory_item_id=item_id,
            category_id=category_id,
            movement_type=InventoryMovementType.USE,
            quantity=trace,
            bird_count=bird_delta,
            occurred_at=occurred_at,
        )
    )
    movements_added.append(
        InventoryMovement(
            shop_id=shop_id,
            inventory_item_id=item_id,
            category_id=category_id,
            movement_type=InventoryMovementType.USE,
            quantity=-trace,
            bird_count=0,
            occurred_at=occurred_at,
        )
    )


async def _get_default_transfer_shop(
    db: AsyncSession,
    organization_id: UUID,
) -> TransferShop | None:
    return await db.scalar(
        select(TransferShop)
        .where(
            TransferShop.organization_id == organization_id,
            TransferShop.is_active.is_(True),
        )
        .order_by(TransferShop.name.asc())
        .limit(1)
    )


async def _list_today_transfer_rows_for_item(
    db: AsyncSession,
    shop_id: UUID,
    item_id: UUID,
) -> list[InventoryTransfer]:
    return list(
        (
            await db.scalars(
                select(InventoryTransfer)
                .where(
                    InventoryTransfer.source_shop_id == shop_id,
                    InventoryTransfer.inventory_item_id == item_id,
                    InventoryTransfer.occurred_at >= ist_midnight(date.today()),
                )
                .order_by(
                    InventoryTransfer.occurred_at.desc(),
                    InventoryTransfer.id.desc(),
                )
                .with_for_update()
            )
        ).all()
    )


async def _admin_adjust_transfer_quantity_today(
    db: AsyncSession,
    shop: Shop,
    item: InventoryItem,
    item_id: UUID,
    target_quantity: Decimal,
    occurred_at: datetime,
) -> bool:
    _, _, _, transferred_today, *_ = await _movement_totals(
        db, shop.id, [item_id], used_since=date.today()
    )
    current = transferred_today.get(item_id, ZERO)
    target = _normalize_nonnegative_quantity(item.base_unit, target_quantity)
    delta = (target - current).quantize(THREE_DECIMALS)
    if delta == ZERO:
        return False

    if delta > ZERO:
        transfer_shop = await _get_default_transfer_shop(db, shop.organization_id)
        if transfer_shop is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="No active transfer shop configured for adjustments",
            )
        db.add(
            InventoryTransfer(
                source_shop_id=shop.id,
                transfer_shop_id=transfer_shop.id,
                inventory_item_id=item_id,
                quantity=delta,
                bird_count=0,
                unit=item.base_unit,
                occurred_at=occurred_at,
            )
        )
        return True

    remaining = abs(delta)
    changed = False
    for row in await _list_today_transfer_rows_for_item(db, shop.id, item_id):
        if remaining <= ZERO:
            break
        row_qty = row.quantity.quantize(THREE_DECIMALS)
        if row_qty <= remaining:
            remaining = (remaining - row_qty).quantize(THREE_DECIMALS)
            await db.delete(row)
            changed = True
        else:
            row.quantity = (row_qty - remaining).quantize(THREE_DECIMALS)
            remaining = ZERO
            changed = True
    if remaining > ZERO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transfer stock cannot be reduced below recorded transfers for today",
        )
    return changed


async def _admin_adjust_transfer_bird_count_today(
    db: AsyncSession,
    shop: Shop,
    item: InventoryItem,
    item_id: UUID,
    target_bird_count: int,
    occurred_at: datetime,
) -> bool:
    if item.base_unit != BaseUnit.KG:
        return False

    _, _, _, _, _, _, _, transferred_today_bird = await _movement_totals(
        db, shop.id, [item_id], used_since=date.today()
    )
    current = transferred_today_bird.get(item_id, 0)
    birds_delta = target_bird_count - current
    if birds_delta == 0:
        return False

    rows = await _list_today_transfer_rows_for_item(db, shop.id, item_id)
    if birds_delta > 0:
        if not rows:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Set transfer stock quantity before setting transfer birds",
            )
        rows[0].bird_count += birds_delta
        return True

    remaining = abs(birds_delta)
    changed = False
    for row in rows:
        if remaining <= 0:
            break
        reducible = min(int(row.bird_count), remaining)
        if reducible <= 0:
            continue
        row.bird_count -= reducible
        remaining -= reducible
        changed = True
    if remaining > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Transfer bird count cannot be reduced below recorded transfers for today",
        )
    return changed


async def admin_set_shop_inventory_stock(
    db: AsyncSession,
    shop: Shop,
    item_id: UUID,
    payload: InventoryStockAdjustRequest,
    *,
    actor: User | None = None,
) -> InventoryItemStockRead:
    """Admin override: set available and/or used stock by creating adjustment movements.

    Available stock is adjusted via ADD (positive delta) or USE (negative delta).
    Used stock (today's display) is adjusted via USE (positive delta) or ADD (negative delta).
    """
    occurred_at = await _prepare_occurred_at(db, actor=actor, shop=shop, raw=payload.occurred_at)
    allocation = await db.scalar(
        select(ShopInventoryAllocation)
        .where(
            ShopInventoryAllocation.shop_id == shop.id,
            ShopInventoryAllocation.inventory_item_id == item_id,
        )
        .with_for_update()
    )
    if allocation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inventory allocation not found"
        )

    item = await db.scalar(
        select(InventoryItem)
        .where(InventoryItem.id == item_id)
        .options(
            selectinload(InventoryItem.category_links).selectinload(InventoryItemCategory.category)
        )
        .with_for_update()
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found"
        )

    (
        added,
        used_alltime,
        _,
        transferred_alltime,
        *_bird,
    ) = await _movement_totals(db, shop.id, [item_id])
    retailer_used_alltime, _, *_retailer_bird = await _retailer_usage_totals(db, shop.id, [item_id])
    _, used_today, _, _, *_ = await _movement_totals(
        db, shop.id, [item_id], used_since=date.today()
    )

    current_available = (
        added.get(item_id, ZERO)
        - used_alltime.get(item.id, ZERO)
        - transferred_alltime.get(item.id, ZERO)
        - retailer_used_alltime.get(item.id, ZERO)
    )
    current_used_today = used_today.get(item_id, ZERO)

    movements_added: list[InventoryMovement] = []

    delta_used = ZERO
    if payload.used_quantity is not None:
        target_used = _normalize_nonnegative_quantity(item.base_unit, payload.used_quantity)
        if payload.category_id:
            _, _, category_used_today_all, _, _, _, _, _ = await _movement_totals(
                db, shop.id, [item_id], used_since=date.today()
            )
            current_used = category_used_today_all.get((item_id, payload.category_id), ZERO)
        else:
            current_used = current_used_today

        delta_used = target_used - current_used
        if delta_used != ZERO:
            # ponytail: adjust used via USE (positive or negative)
            movements_added.append(
                InventoryMovement(
                    shop_id=shop.id,
                    inventory_item_id=item_id,
                    category_id=payload.category_id,
                    movement_type=InventoryMovementType.USE,
                    quantity=delta_used,
                    occurred_at=occurred_at,
                )
            )

    if payload.available_quantity is not None:
        target_available = _normalize_nonnegative_quantity(
            item.base_unit, payload.available_quantity
        )
        # ponytail: adjust available via ADD (positive or negative), counteracting any delta_used so target is hit exactly
        delta_available = (target_available - current_available) + delta_used
        if delta_available != ZERO:
            movements_added.append(
                InventoryMovement(
                    shop_id=shop.id,
                    inventory_item_id=item_id,
                    movement_type=InventoryMovementType.ADD,
                    quantity=delta_available,
                    occurred_at=occurred_at,
                )
            )

    if payload.available_bird_count is not None and item.base_unit == BaseUnit.KG:
        _, current_available_bird = await _bird_availability_for_transaction(
            db,
            shop.id,
            item_id,
            raw_occurred_at=payload.occurred_at,
            occurred_at=occurred_at,
        )
        delta_birds = payload.available_bird_count - current_available_bird
        _append_kg_neutral_available_bird_movements(
            movements_added,
            shop_id=shop.id,
            item_id=item_id,
            delta_birds=delta_birds,
            occurred_at=occurred_at,
        )

    if payload.used_bird_count is not None and item.base_unit == BaseUnit.KG:
        if payload.category_id:
            _, _, _, _, _, _, category_used_today_bird, _ = await _movement_totals(
                db, shop.id, [item_id], used_since=date.today()
            )
            current_used_bird = category_used_today_bird.get((item_id, payload.category_id), 0)
        else:
            _, _, _, _, _, used_today_bird, _, _ = await _movement_totals(
                db, shop.id, [item_id], used_since=date.today()
            )
            current_used_bird = used_today_bird.get(item_id, 0)
        delta_used_birds = payload.used_bird_count - current_used_bird
        _append_kg_neutral_used_bird_movements(
            movements_added,
            shop_id=shop.id,
            item_id=item_id,
            category_id=payload.category_id,
            delta_birds=delta_used_birds,
            occurred_at=occurred_at,
        )

    transfer_changed = False
    if payload.transfer_quantity is not None:
        transfer_changed = (
            await _admin_adjust_transfer_quantity_today(
                db,
                shop,
                item,
                item_id,
                payload.transfer_quantity,
                occurred_at,
            )
            or transfer_changed
        )
    if payload.transfer_bird_count is not None:
        transfer_changed = (
            await _admin_adjust_transfer_bird_count_today(
                db,
                shop,
                item,
                item_id,
                payload.transfer_bird_count,
                occurred_at,
            )
            or transfer_changed
        )

    for movement in movements_added:
        db.add(movement)
    if movements_added or transfer_changed:
        await db.commit()

    return await _stock_item_for_shop_inventory_item(
        db, shop, item, allocation, used_since=date.today()
    )
