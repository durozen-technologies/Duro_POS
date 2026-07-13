import json
from datetime import date, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.global_image_templates import (
    build_resolved_item_image_paths,
    get_active_template,
    resolve_item_image_keys,
)
from app.models import (
    BaseUnit,
    GlobalImageTemplate,
    Item,
    ItemAssumptionStatus,
    ItemCategory,
    ItemChangeEvent,
    Shop,
)
from app.schemas.admin import (
    ItemCategoryCreate,
    ItemCategoryRead,
    ItemCategoryUpdate,
    ItemRead,
    PriceStatus,
    ShopRead,
)
from app.services.tenant_query import resolve_organization_id

__all__ = [
    "_shop_to_read",
    "_item_assumption_status",
    "_item_assumption_read_kwargs",
    "_item_to_read",
    "_item_to_read_async",
    "_merge_custom_attributes",
    "_custom_attributes_dict",
    "_coalesce_text",
    "_price_status_for",
    "_zero_if_null",
    "_count_query_rows",
    "_sum_if",
    "_json_safe_item_state",
    "_record_item_event",
    "_shop_item_visibility_filter",
    "_normalize_item_name",
    "_normalize_tamil_item_name",
    "_ensure_unique_item_name",
    "_normalize_category_name",
    "list_item_categories",
    "create_item_category",
    "update_item_category",
    "delete_item_category",
    "_find_or_create_item_category",
    "_resolve_item_category",
]


def _shop_to_read(shop: Shop, last_active_at: datetime | None = None) -> ShopRead:
    return ShopRead(
        id=shop.id,
        name=shop.name,
        is_active=shop.is_active,
        created_at=shop.created_at,
        username=shop.owner.username,
        last_active_at=last_active_at if last_active_at is not None else shop.owner.last_login_at,
    )


def _item_assumption_status(
    base_unit: BaseUnit,
    assumption_percent,
    assumption_inventory_item_id: UUID | None,
    assumption_inventory_category_id: UUID | None,
) -> ItemAssumptionStatus:
    if base_unit != BaseUnit.KG:
        return ItemAssumptionStatus.NOT_APPLICABLE
    if (
        assumption_percent is None
        and assumption_inventory_item_id is None
        and assumption_inventory_category_id is None
    ):
        return ItemAssumptionStatus.NOT_SET
    if assumption_percent is not None:
        return ItemAssumptionStatus.CONFIGURED
    return ItemAssumptionStatus.INCOMPLETE


def _item_assumption_read_kwargs(row) -> dict[str, object | None]:
    return {
        "assumption_percent": row.assumption_percent,
        "assumption_inventory_item_id": row.assumption_inventory_item_id,
        "assumption_inventory_category_id": row.assumption_inventory_category_id,
        "assumption_status": _item_assumption_status(
            row.base_unit,
            row.assumption_percent,
            row.assumption_inventory_item_id,
            row.assumption_inventory_category_id,
        ),
    }


def _item_to_read(
    item: Item,
    *,
    template: GlobalImageTemplate | None = None,
) -> ItemRead:
    loaded_category = item.__dict__.get("category_ref")
    image_path, image_thumb_path = build_resolved_item_image_paths(item, template)
    resolved = resolve_item_image_keys(item, template)
    return ItemRead(
        id=item.id,
        shop_id=item.shop_id,
        name=item.name,
        tamil_name=item.tamil_name,
        unit_type=item.unit_type,
        base_unit=item.base_unit,
        sort_order=item.sort_order,
        category_id=item.category_id,
        category=loaded_category.name if loaded_category is not None else item.category,
        is_active=item.is_active,
        created_at=item.created_at,
        updated_at=item.updated_at,
        custom_attributes=item.custom_attributes or {},
        global_image_template_id=item.global_image_template_id,
        **_item_assumption_read_kwargs(item),
        image_path=image_path,
        image_thumb_path=image_thumb_path,
        image_content_type=resolved.image_content_type,
    )


async def _item_to_read_async(
    item: Item,
    *,
    platform_db: AsyncSession | None = None,
) -> ItemRead:
    template = None
    if item.global_image_template_id and not item.image_object_key and platform_db is not None:
        template = await get_active_template(platform_db, item.global_image_template_id)
    return _item_to_read(item, template=template)


def _merge_custom_attributes(
    item_attributes: dict[str, object | None] | str | None,
    allocation_attributes: dict[str, object | None] | str | None,
    *,
    is_allocated: bool,
) -> dict[str, object | None]:
    attributes = _custom_attributes_dict(item_attributes)
    if is_allocated:
        attributes.update(_custom_attributes_dict(allocation_attributes))
    return attributes


def _custom_attributes_dict(
    value: dict[str, object | None] | str | None,
) -> dict[str, object | None]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return dict(decoded) if isinstance(decoded, dict) else {}
    return {}


def _coalesce_text(*values: str | None) -> str | None:
    for value in values:
        if value is not None and value.strip():
            return value.strip()
    return None


def _price_status_for(price_date: date | None, *, is_required: bool) -> PriceStatus:
    if not is_required or price_date is None:
        return PriceStatus.MISSING
    return PriceStatus.CURRENT if price_date == date.today() else PriceStatus.STALE


def _zero_if_null(value: object) -> int:
    return int(value or 0)


async def _count_query_rows(db: AsyncSession, query) -> int:
    return int(await db.scalar(select(func.count()).select_from(query.subquery())) or 0)


def _sum_if(condition):
    return func.coalesce(func.sum(case((condition, 1), else_=0)), 0)


def _json_safe_item_state(item: Item | None) -> dict[str, object | None]:
    if item is None:
        return {}
    return {
        "id": str(item.id),
        "shop_id": str(item.shop_id) if item.shop_id else None,
        "name": item.name,
        "tamil_name": item.tamil_name,
        "unit_type": item.unit_type.value,
        "base_unit": item.base_unit.value,
        "sort_order": item.sort_order,
        "category_id": str(item.category_id) if item.category_id else None,
        "category": item.category,
        "is_active": item.is_active,
        "custom_attributes": dict(item.custom_attributes or {}),
        "assumption_percent": str(item.assumption_percent)
        if item.assumption_percent is not None
        else None,
        "assumption_inventory_item_id": (
            str(item.assumption_inventory_item_id) if item.assumption_inventory_item_id else None
        ),
        "assumption_inventory_category_id": (
            str(item.assumption_inventory_category_id)
            if item.assumption_inventory_category_id
            else None
        ),
        "image_object_key": item.image_object_key,
        "image_content_type": item.image_content_type,
        "image_thumbnail_object_key": item.image_thumbnail_object_key,
        "image_thumbnail_content_type": item.image_thumbnail_content_type,
        "global_image_template_id": (
            str(item.global_image_template_id) if item.global_image_template_id else None
        ),
    }


def _record_item_event(
    db: AsyncSession,
    *,
    item_id: UUID | None,
    shop_id: UUID | None,
    event_type: str,
    before: dict[str, object | None] | None = None,
    after: dict[str, object | None] | None = None,
) -> None:
    db.add(
        ItemChangeEvent(
            item_id=item_id,
            shop_id=shop_id,
            event_type=event_type,
            before=before or {},
            after=after or {},
        )
    )


def _shop_item_visibility_filter(shop_id: UUID, organization_id: UUID):
    return and_(
        Item.organization_id == organization_id,
        or_(Item.shop_id.is_(None), Item.shop_id == shop_id),
    )


def _normalize_item_name(raw_name: str) -> str:
    item_name = raw_name.strip()
    if len(item_name) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Item name is required",
        )
    return item_name


def _normalize_tamil_item_name(raw_name: str) -> str:
    item_name = raw_name.strip()
    if not item_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Tamil item name is required",
        )
    return item_name


async def _ensure_unique_item_name(
    db: AsyncSession,
    item_name: str,
    *,
    shop_id: UUID | None = None,
    organization_id: UUID | None = None,
    exclude_item_id: UUID | None = None,
) -> None:
    org_id = organization_id or await resolve_organization_id(db, shop_id=shop_id)
    filters = [
        func.lower(Item.name) == item_name.lower(),
        Item.organization_id == org_id,
    ]
    if shop_id is not None:
        filters.append(Item.shop_id == shop_id)
    else:
        filters.append(Item.shop_id.is_(None))
    if exclude_item_id is not None:
        filters.append(Item.id != exclude_item_id)

    existing_item = await db.scalar(select(Item.id).where(*filters).limit(1))
    if existing_item is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Item name already exists")


def _normalize_category_name(raw_name: str) -> str:
    category_name = raw_name.strip()
    if not category_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Category name is required",
        )
    return category_name


async def list_item_categories(
    db: AsyncSession, organization_id: UUID | None = None
) -> list[ItemCategoryRead]:
    org_id = organization_id or await resolve_organization_id(db)
    rows = await db.scalars(
        select(ItemCategory)
        .where(ItemCategory.organization_id == org_id)
        .order_by(func.lower(ItemCategory.name), ItemCategory.id)
    )
    return [ItemCategoryRead.model_validate(category) for category in rows.all()]


async def create_item_category(
    db: AsyncSession, payload: ItemCategoryCreate, organization_id: UUID | None = None
) -> ItemCategoryRead:
    org_id = organization_id or await resolve_organization_id(db)
    category_name = _normalize_category_name(payload.name)
    existing = await db.scalar(
        select(ItemCategory).where(
            func.lower(ItemCategory.name) == category_name.lower(),
            ItemCategory.organization_id == org_id,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Category already exists")

    category = ItemCategory(name=category_name, organization_id=org_id)
    db.add(category)
    await db.flush()
    await db.commit()
    return ItemCategoryRead.model_validate(category)


async def update_item_category(
    db: AsyncSession,
    category_id: UUID,
    payload: ItemCategoryUpdate,
    organization_id: UUID | None = None,
) -> ItemCategoryRead:
    org_id = organization_id or await resolve_organization_id(db)
    category_name = _normalize_category_name(payload.name)
    category = await db.scalar(
        select(ItemCategory)
        .where(ItemCategory.id == category_id, ItemCategory.organization_id == org_id)
        .with_for_update()
    )
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    if category.name == category_name:
        return ItemCategoryRead.model_validate(category)

    category_key = category_name.lower()
    if category.name.lower() != category_key:
        existing = await db.scalar(
            select(ItemCategory.id)
            .where(
                func.lower(ItemCategory.name) == category_key,
                ItemCategory.organization_id == org_id,
            )
            .limit(1)
        )
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Category already exists"
            )

    category.name = category_name
    await db.execute(
        Item.__table__.update()
        .where(
            Item.category_id == category_id,
            or_(Item.category.is_(None), Item.category != category_name),
        )
        .values(category=category_name)
    )
    await db.commit()
    return ItemCategoryRead.model_validate(category)


async def delete_item_category(
    db: AsyncSession, category_id: UUID, organization_id: UUID | None = None
) -> None:
    org_id = organization_id or await resolve_organization_id(db)
    category = await db.scalar(
        select(ItemCategory)
        .where(ItemCategory.id == category_id, ItemCategory.organization_id == org_id)
        .with_for_update()
    )
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    await db.execute(
        Item.__table__.update()
        .where(Item.category_id == category_id)
        .values(category_id=None, category=None)
    )
    await db.delete(category)
    await db.commit()


async def _find_or_create_item_category(
    db: AsyncSession, category_name: str, organization_id: UUID | None = None
) -> ItemCategory:
    org_id = organization_id or await resolve_organization_id(db)
    normalized_name = _normalize_category_name(category_name)
    category = await db.scalar(
        select(ItemCategory).where(
            func.lower(ItemCategory.name) == normalized_name.lower(),
            ItemCategory.organization_id == org_id,
        )
    )
    if category is not None:
        return category
    category = ItemCategory(name=normalized_name, organization_id=org_id)
    db.add(category)
    return category


async def _resolve_item_category(
    db: AsyncSession,
    *,
    category_id: UUID | None,
    category_name: str | None,
    organization_id: UUID | None = None,
) -> ItemCategory | None:
    org_id = organization_id or await resolve_organization_id(db)
    if category_id is not None:
        category = await db.scalar(
            select(ItemCategory).where(
                ItemCategory.id == category_id,
                ItemCategory.organization_id == org_id,
            )
        )
        if category is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
        return category
    normalized_name = _coalesce_text(category_name)
    if normalized_name is None:
        return None
    return await _find_or_create_item_category(db, normalized_name, organization_id=org_id)
