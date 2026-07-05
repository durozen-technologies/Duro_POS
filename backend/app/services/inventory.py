from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import and_, case, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.ids import uuid7
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
    Shop,
    ShopInventoryAllocation,
    User,
)
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
) -> InventoryItemRowsPage:
    query = _inventory_items_row_query(q=q, active=active)
    cursor_condition = _inventory_item_cursor_filter(
        cursor_sort_order,
        cursor_name,
        cursor_id,
    )
    if cursor_condition is not None:
        query = query.where(cursor_condition)

    rows = (
        await db.execute(
            query.order_by(
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

    next_cursor_sort_order = next_cursor_name = next_cursor_id = None
    if has_more and page_rows:
        last_row = page_rows[-1]
        next_cursor_sort_order = last_row.sort_order
        next_cursor_name = last_row.name.lower()
        next_cursor_id = last_row.id

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
    dict[UUID, Decimal], dict[UUID, Decimal], dict[tuple[UUID, UUID], Decimal], dict[UUID, Decimal]
]:
    """Return (added, used, category_used) totals for the given items.

    ``added`` is always the all-time total so that available stock is correct.
    ``used`` / ``category_used`` are filtered to movements on or after
    ``used_since`` when that parameter is supplied (e.g. today's date), which
    lets the shop screen display a daily-resetting used counter without losing
    any data in the database or history view.
    """
    if not item_ids:
        return {}, {}, {}, {}

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
            )
            .where(*add_filter)
            .group_by(InventoryMovement.inventory_item_id)
        )
    ).all()
    added: dict[UUID, Decimal] = {row.inventory_item_id: row.quantity or ZERO for row in add_rows}

    # USE movements — optionally scoped to a start date
    use_filter = [
        InventoryMovement.shop_id == shop_id,
        InventoryMovement.inventory_item_id.in_(item_ids),
        InventoryMovement.movement_type == InventoryMovementType.USE,
    ]
    if used_since is not None:
        use_filter.append(
            InventoryMovement.occurred_at >= datetime.combine(used_since, time.min, tzinfo=UTC)
        )
    if as_of is not None:
        use_filter.append(InventoryMovement.occurred_at <= as_of)

    use_rows = (
        await db.execute(
            select(
                InventoryMovement.inventory_item_id,
                func.coalesce(func.sum(InventoryMovement.quantity), 0).label("quantity"),
            )
            .where(*use_filter)
            .group_by(InventoryMovement.inventory_item_id)
        )
    ).all()
    used: dict[UUID, Decimal] = {row.inventory_item_id: row.quantity or ZERO for row in use_rows}

    category_rows = (
        await db.execute(
            select(
                InventoryMovement.inventory_item_id,
                InventoryMovement.category_id,
                func.coalesce(func.sum(InventoryMovement.quantity), 0).label("quantity"),
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

    # TRANSFERRED_OUT — all-time unless point-in-time ``as_of`` is set
    transfer_filter = [
        InventoryTransfer.source_shop_id == shop_id,
        InventoryTransfer.inventory_item_id.in_(item_ids),
    ]
    if as_of is not None:
        transfer_filter.append(InventoryTransfer.occurred_at <= as_of)
    transfer_rows = (
        await db.execute(
            select(
                InventoryTransfer.inventory_item_id,
                func.coalesce(func.sum(InventoryTransfer.quantity), 0).label("quantity"),
            )
            .where(*transfer_filter)
            .group_by(InventoryTransfer.inventory_item_id)
        )
    ).all()
    transferred_out = {row.inventory_item_id: row.quantity or ZERO for row in transfer_rows}

    return added, used, category_used, transferred_out


def _stock_item_from_inventory_item(
    item: InventoryItem,
    *,
    allocation: ShopInventoryAllocation | None,
    added_quantity: Decimal,
    used_quantity: Decimal,
    available_quantity: Decimal | None = None,
    category_used: dict[tuple[UUID, UUID], Decimal],
) -> InventoryItemStockRead:
    """Build a stock read object.

    ``available_quantity`` may be supplied explicitly when the caller has
    separate all-time and display (e.g. today-scoped) ``used_quantity`` values.
    If omitted it is computed as ``added_quantity - used_quantity``.
    """
    base = _inventory_item_to_read(item)
    if available_quantity is None:
        available_quantity = added_quantity - used_quantity

    category_usage = [
        InventoryCategoryUsageRead(
            category_id=category.id,
            category_name=category.name,
            available_quantity=available_quantity,
            used_quantity=category_used.get((item.id, category.id), ZERO),
        )
        for category in base.categories
    ]

    # ponytail: if an item has categories, its total used quantity is strictly the sum of category usage.
    if category_usage:
        used_quantity = sum((cat.used_quantity for cat in category_usage), ZERO)

    return InventoryItemStockRead(
        **base.model_dump(),
        allocated=allocation is not None,
        allocation_active=bool(allocation and allocation.is_active and item.is_active),
        allocation_sort_order=allocation.sort_order if allocation is not None else item.sort_order,
        available_quantity=available_quantity,
        added_quantity=added_quantity,
        used_quantity=used_quantity,
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
    added, used, category_used, transferred_out = await _movement_totals(db, shop.id, item_ids)
    stock_items = [
        _stock_item_from_inventory_item(
            item,
            allocation=allocations_by_item_id.get(item.id),
            added_quantity=added.get(item.id, ZERO),
            used_quantity=used.get(item.id, ZERO),
            available_quantity=added.get(item.id, ZERO)
            - used.get(item.id, ZERO)
            - transferred_out.get(item.id, ZERO),
            category_used=category_used,
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
                )
            else:
                existing.available_quantity += category.available_quantity
                existing.used_quantity += category.used_quantity

    return InventorySummaryRead(
        shop_id=shop.id,
        shop_name=shop.name,
        items=stock_items,
        categories=sorted(
            category_totals.values(),
            key=lambda category: (category.category_name.lower(), str(category.category_id)),
        ),
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
    added, used_alltime, _, transferred_alltime = await _movement_totals(db, shop.id, item_ids)
    _, used_today, category_used_today, _ = await _movement_totals(
        db, shop.id, item_ids, used_since=date.today()
    )

    stock_items = [
        _stock_item_from_inventory_item(
            item,
            allocation=allocation,
            added_quantity=added.get(item.id, ZERO),
            # Display: today's usage (resets daily)
            used_quantity=used_today.get(item.id, ZERO),
            # Availability: reduced by used_alltime stock
            available_quantity=added.get(item.id, ZERO)
            - used_alltime.get(item.id, ZERO)
            - transferred_alltime.get(item.id, ZERO),
            category_used=category_used_today,
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

    return InventoryStockRowsPage(
        shop_id=shop.id,
        shop_name=shop.name,
        items=stock_items,
        limit=limit,
        has_more=has_more,
        next_cursor_sort_order=next_cursor_sort_order,
        next_cursor_name=next_cursor_name,
        next_cursor_id=next_cursor_id,
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
    added, used, _, transferred = await _movement_totals(db, shop_id, [item_id], as_of=as_of)
    return added.get(item_id, ZERO) - used.get(item_id, ZERO) - transferred.get(item_id, ZERO)


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
    added, used_alltime, category_used_alltime, transferred_alltime = await _movement_totals(
        db, shop.id, [item.id]
    )
    if used_since is not None:
        _, used_display, category_used_display, _ = await _movement_totals(
            db, shop.id, [item.id], used_since=used_since
        )
    else:
        used_display = used_alltime
        category_used_display = category_used_alltime
    return _stock_item_from_inventory_item(
        item,
        allocation=allocation,
        added_quantity=added.get(item.id, ZERO),
        used_quantity=used_display.get(item.id, ZERO),
        available_quantity=added.get(item.id, ZERO)
        - used_alltime.get(item.id, ZERO)
        - transferred_alltime.get(item.id, ZERO),
        category_used=category_used_display,
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
                >= datetime.combine(range_start_date, time.min, tzinfo=UTC)
            )
        if range_end_date is not None:
            query = query.where(
                InventoryMovement.occurred_at
                < datetime.combine(range_end_date + timedelta(days=1), time.min, tzinfo=UTC)
            )
    elif reference_date is not None:
        query = query.where(
            InventoryMovement.occurred_at >= datetime.combine(reference_date, time.min, tzinfo=UTC),
            InventoryMovement.occurred_at
            < datetime.combine(reference_date + timedelta(days=1), time.min, tzinfo=UTC),
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
                >= datetime.combine(range_start_date, time.min, tzinfo=UTC)
            )
        if range_end_date is not None:
            query = query.where(
                InventoryTransfer.occurred_at
                < datetime.combine(range_end_date + timedelta(days=1), time.min, tzinfo=UTC)
            )
    elif reference_date is not None:
        query = query.where(
            InventoryTransfer.occurred_at >= datetime.combine(reference_date, time.min, tzinfo=UTC),
            InventoryTransfer.occurred_at
            < datetime.combine(reference_date + timedelta(days=1), time.min, tzinfo=UTC),
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
    available_quantity = await _available_quantity_at(db, shop.id, item.id, as_of=occurred_at)
    if quantity > available_quantity:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Inventory use exceeds available item quantity",
        )
    movement = InventoryMovement(
        shop_id=shop.id,
        inventory_item_id=item.id,
        category_id=payload.category_id,
        movement_type=InventoryMovementType.USE,
        quantity=quantity,
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
    for line in payload.categories:
        if line.category_id not in linked_category_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Inventory category is not linked to this item",
            )
        quantity = _normalize_nonnegative_quantity(item.base_unit, line.quantity)
        split_quantities[line.category_id] = split_quantities.get(line.category_id, ZERO) + quantity

    split_quantities = {
        category_id: quantity
        for category_id, quantity in split_quantities.items()
        if quantity > ZERO
    }
    split_total = sum(split_quantities.values(), ZERO).quantize(THREE_DECIMALS)
    if not split_quantities or split_total != total_quantity:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Category split total must match the inventory use quantity",
        )

    available_quantity = await _available_quantity_at(db, shop.id, item.id, as_of=occurred_at)
    if total_quantity > available_quantity:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Inventory use exceeds available item quantity",
        )

    movements = [
        InventoryMovement(
            shop_id=shop.id,
            inventory_item_id=item.id,
            category_id=category_id,
            movement_type=InventoryMovementType.USE,
            quantity=quantity,
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

    added, used_alltime, _, transferred_alltime = await _movement_totals(db, shop.id, [item_id])
    _, used_today, _, _ = await _movement_totals(db, shop.id, [item_id], used_since=date.today())

    current_available = (
        added.get(item_id, ZERO)
        - used_alltime.get(item.id, ZERO)
        - transferred_alltime.get(item.id, ZERO)
    )
    current_used_today = used_today.get(item_id, ZERO)

    movements_added: list[InventoryMovement] = []

    delta_used = ZERO
    if payload.used_quantity is not None:
        target_used = _normalize_nonnegative_quantity(item.base_unit, payload.used_quantity)
        if payload.category_id:
            _, _, category_used_today_all, _ = await _movement_totals(
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

    for movement in movements_added:
        db.add(movement)
    if movements_added:
        await db.commit()

    return await _stock_item_for_shop_inventory_item(
        db, shop, item, allocation, used_since=date.today()
    )
