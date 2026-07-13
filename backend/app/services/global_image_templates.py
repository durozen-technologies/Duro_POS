from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.storage import (
    build_expense_item_image_path,
    build_expense_item_image_thumb_path,
    build_global_image_template_image_path,
    build_global_image_template_image_thumb_path,
    build_inventory_item_image_path,
    build_inventory_item_image_thumb_path,
    build_item_image_path,
    build_item_image_thumb_path,
    save_global_image_template_upload,
)
from app.models import ExpenseItem, GlobalImageTemplate, GlobalImageTemplateCategory, InventoryItem, Item


@dataclass(frozen=True)
class ResolvedItemImageKeys:
    image_object_key: str | None
    image_content_type: str | None
    image_thumbnail_object_key: str | None
    image_thumbnail_content_type: str | None


def resolve_item_image_keys(
    item: Item | InventoryItem | ExpenseItem,
    template: GlobalImageTemplate | None = None,
) -> ResolvedItemImageKeys:
    if item.image_object_key:
        return ResolvedItemImageKeys(
            image_object_key=item.image_object_key,
            image_content_type=item.image_content_type,
            image_thumbnail_object_key=item.image_thumbnail_object_key,
            image_thumbnail_content_type=item.image_thumbnail_content_type,
        )
    if template is not None and template.is_active:
        return ResolvedItemImageKeys(
            image_object_key=template.image_object_key,
            image_content_type=template.image_content_type,
            image_thumbnail_object_key=template.image_thumbnail_object_key,
            image_thumbnail_content_type=template.image_thumbnail_content_type,
        )
    return ResolvedItemImageKeys(None, None, None, None)


def build_item_image_paths(
    item_id: UUID,
    *,
    image_object_key: str | None,
    image_content_type: str | None,
    image_thumbnail_object_key: str | None,
    image_thumbnail_content_type: str | None,
) -> tuple[str | None, str | None]:
    return (
        build_item_image_path(item_id, image_object_key, image_content_type),
        build_item_image_thumb_path(
            item_id,
            image_thumbnail_object_key,
            image_thumbnail_content_type,
            original_object_key=image_object_key,
        ),
    )


def build_resolved_item_image_paths(
    item: Item,
    template: GlobalImageTemplate | None = None,
) -> tuple[str | None, str | None]:
    if item.image_object_key:
        keys = resolve_item_image_keys(item, None)
        return build_item_image_paths(
            item.id,
            image_object_key=keys.image_object_key,
            image_content_type=keys.image_content_type,
            image_thumbnail_object_key=keys.image_thumbnail_object_key,
            image_thumbnail_content_type=keys.image_thumbnail_content_type,
        )
    if template is not None and template.is_active:
        return build_global_image_template_image_paths(template)
    return None, None


def build_global_image_template_image_paths(
    template: GlobalImageTemplate,
) -> tuple[str | None, str | None]:
    return (
        build_global_image_template_image_path(
            template.id,
            template.image_object_key,
            template.image_content_type,
        ),
        build_global_image_template_image_thumb_path(
            template.id,
            template.image_thumbnail_object_key,
            template.image_thumbnail_content_type,
            original_object_key=template.image_object_key,
        ),
    )


async def load_templates_for_item_rows(
    rows: list[object],
) -> dict[UUID, GlobalImageTemplate]:
    template_ids = {
        row.global_image_template_id
        for row in rows
        if getattr(row, "global_image_template_id", None) is not None
        and not getattr(row, "image_object_key", None)
    }
    if not template_ids:
        return {}

    from app.db.database import get_session_local
    from app.db.tenant_schema import set_search_path

    async with get_session_local()() as platform_db:
        await set_search_path(platform_db, None)
        return await fetch_active_templates_by_ids(platform_db, template_ids)


def build_image_paths_for_row(
    row: object,
    templates_by_id: dict[UUID, GlobalImageTemplate],
) -> tuple[str | None, str | None, str | None]:
    global_template_id = getattr(row, "global_image_template_id", None)
    if getattr(row, "image_object_key", None):
        return (
            build_item_image_path(
                row.id,
                row.image_object_key,
                getattr(row, "image_content_type", None),
            ),
            build_item_image_thumb_path(
                row.id,
                getattr(row, "image_thumbnail_object_key", None),
                getattr(row, "image_thumbnail_content_type", None),
                original_object_key=row.image_object_key,
            ),
            getattr(row, "image_content_type", None),
        )

    template = None
    if global_template_id is not None:
        template = templates_by_id.get(global_template_id)
    if template is not None and template.is_active:
        image_path, image_thumb_path = build_global_image_template_image_paths(template)
        return image_path, image_thumb_path, template.image_content_type
    return None, None, None


def build_inventory_image_paths_for_row(
    row: object,
    templates_by_id: dict[UUID, GlobalImageTemplate],
) -> tuple[str | None, str | None, str | None]:
    global_template_id = getattr(row, "global_image_template_id", None)
    if getattr(row, "image_object_key", None):
        return (
            build_inventory_item_image_path(
                row.id,
                row.image_object_key,
                getattr(row, "image_content_type", None),
            ),
            build_inventory_item_image_thumb_path(
                row.id,
                getattr(row, "image_thumbnail_object_key", None),
                getattr(row, "image_thumbnail_content_type", None),
                original_object_key=row.image_object_key,
            ),
            getattr(row, "image_content_type", None),
        )
    template = templates_by_id.get(global_template_id) if global_template_id is not None else None
    if template is not None and template.is_active:
        image_path, image_thumb_path = build_global_image_template_image_paths(template)
        return image_path, image_thumb_path, template.image_content_type
    return None, None, None


def build_expense_image_paths_for_row(
    row: object,
    templates_by_id: dict[UUID, GlobalImageTemplate],
) -> tuple[str | None, str | None, str | None]:
    global_template_id = getattr(row, "global_image_template_id", None)
    if getattr(row, "image_object_key", None):
        return (
            build_expense_item_image_path(
                row.id,
                row.image_object_key,
                getattr(row, "image_content_type", None),
            ),
            build_expense_item_image_thumb_path(
                row.id,
                getattr(row, "image_thumbnail_object_key", None),
                getattr(row, "image_thumbnail_content_type", None),
                original_object_key=row.image_object_key,
            ),
            getattr(row, "image_content_type", None),
        )
    template = templates_by_id.get(global_template_id) if global_template_id is not None else None
    if template is not None and template.is_active:
        image_path, image_thumb_path = build_global_image_template_image_paths(template)
        return image_path, image_thumb_path, template.image_content_type
    return None, None, None


def build_resolved_inventory_item_image_paths(
    item: InventoryItem,
    template: GlobalImageTemplate | None = None,
) -> tuple[str | None, str | None]:
    if item.image_object_key:
        return (
            build_inventory_item_image_path(item.id, item.image_object_key, item.image_content_type),
            build_inventory_item_image_thumb_path(
                item.id,
                item.image_thumbnail_object_key,
                item.image_thumbnail_content_type,
                original_object_key=item.image_object_key,
            ),
        )
    if template is not None and template.is_active:
        return build_global_image_template_image_paths(template)
    return None, None


def build_resolved_expense_item_image_paths(
    item: ExpenseItem,
    template: GlobalImageTemplate | None = None,
) -> tuple[str | None, str | None]:
    if item.image_object_key:
        return (
            build_expense_item_image_path(item.id, item.image_object_key, item.image_content_type),
            build_expense_item_image_thumb_path(
                item.id,
                item.image_thumbnail_object_key,
                item.image_thumbnail_content_type,
                original_object_key=item.image_object_key,
            ),
        )
    if template is not None and template.is_active:
        return build_global_image_template_image_paths(template)
    return None, None


async def get_active_template(
    db: AsyncSession,
    template_id: UUID,
) -> GlobalImageTemplate | None:
    template = await db.get(GlobalImageTemplate, template_id)
    if template is None or not template.is_active:
        return None
    return template


async def require_active_template(
    db: AsyncSession,
    template_id: UUID,
) -> GlobalImageTemplate:
    template = await get_active_template(db, template_id)
    if template is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Global image template not found or inactive",
        )
    return template


async def resolve_effective_item_image_keys(
    item: Item,
    platform_db: AsyncSession | None,
) -> ResolvedItemImageKeys:
    if item.image_object_key:
        return resolve_item_image_keys(item, None)
    if platform_db is not None and item.global_image_template_id is not None:
        template = await get_active_template(platform_db, item.global_image_template_id)
        return resolve_item_image_keys(item, template)
    return resolve_item_image_keys(item, None)


async def resolve_effective_inventory_item_image_keys(
    item: InventoryItem,
    platform_db: AsyncSession | None,
) -> ResolvedItemImageKeys:
    if item.image_object_key:
        return resolve_item_image_keys(item, None)
    if platform_db is not None and item.global_image_template_id is not None:
        template = await get_active_template(platform_db, item.global_image_template_id)
        return resolve_item_image_keys(item, template)
    return resolve_item_image_keys(item, None)


async def resolve_effective_expense_item_image_keys(
    item: ExpenseItem,
    platform_db: AsyncSession | None,
) -> ResolvedItemImageKeys:
    if item.image_object_key:
        return resolve_item_image_keys(item, None)
    if platform_db is not None and item.global_image_template_id is not None:
        template = await get_active_template(platform_db, item.global_image_template_id)
        return resolve_item_image_keys(item, template)
    return resolve_item_image_keys(item, None)


async def apply_global_image_template_selection(
    item: Item | InventoryItem | ExpenseItem,
    *,
    platform_db: AsyncSession,
    global_image_template_id: UUID | None,
) -> None:
    if global_image_template_id is None:
        item.global_image_template_id = None
        return
    await require_active_template(platform_db, global_image_template_id)
    item.global_image_template_id = global_image_template_id
    item.image_object_key = None
    item.image_content_type = None
    item.image_thumbnail_object_key = None
    item.image_thumbnail_content_type = None


async def fetch_active_templates_by_ids(
    db: AsyncSession,
    template_ids: set[UUID],
) -> dict[UUID, GlobalImageTemplate]:
    if not template_ids:
        return {}
    templates = (
        await db.scalars(
            select(GlobalImageTemplate).where(
                GlobalImageTemplate.id.in_(template_ids),
                GlobalImageTemplate.is_active.is_(True),
            )
        )
    ).all()
    return {template.id: template for template in templates}


async def list_active_global_image_templates(
    db: AsyncSession,
    *,
    active_only: bool = True,
) -> list[GlobalImageTemplate]:
    query = select(GlobalImageTemplate).order_by(
        GlobalImageTemplate.sort_order,
        GlobalImageTemplate.name,
        GlobalImageTemplate.id,
    )
    if active_only:
        query = query.where(GlobalImageTemplate.is_active.is_(True))
    return list((await db.scalars(query)).all())


def template_to_read(
    template: GlobalImageTemplate,
) -> dict[str, object]:
    from app.schemas.super_admin.global_image_templates import GlobalImageTemplateRead

    category_name = None
    loaded_category = template.__dict__.get("category_ref")
    if loaded_category is not None:
        category_name = loaded_category.name
    image_path, image_thumb_path = build_global_image_template_image_paths(template)
    return GlobalImageTemplateRead(
        id=template.id,
        name=template.name,
        category_id=template.category_id,
        category_name=category_name,
        sort_order=template.sort_order,
        is_active=template.is_active,
        image_path=image_path,
        image_thumb_path=image_thumb_path,
        image_content_type=template.image_content_type,
        created_at=template.created_at,
        updated_at=template.updated_at,
    )


async def create_global_image_template(
    db: AsyncSession,
    *,
    name: str,
    category_id: UUID | None,
    sort_order: int,
    is_active: bool,
    image: UploadFile | None,
) -> GlobalImageTemplate:
    normalized_name = name.strip()
    if len(normalized_name) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Template name is required",
        )
    if category_id is not None:
        category = await db.get(GlobalImageTemplateCategory, category_id)
        if category is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Template category not found",
            )

    template = GlobalImageTemplate(
        name=normalized_name,
        category_id=category_id,
        sort_order=sort_order,
        is_active=is_active,
    )
    db.add(template)
    await db.flush()
    if image is not None:
        await save_global_image_template_upload(db, template, image, commit=False)
    await db.commit()
    await db.refresh(template)
    return template


async def update_global_image_template(
    db: AsyncSession,
    template_id: UUID,
    *,
    name: str | None,
    category_id: UUID | None | object = ...,
    sort_order: int | None,
    is_active: bool | None,
    image: UploadFile | None,
    remove_image: bool,
) -> GlobalImageTemplate:
    template = await db.scalar(
        select(GlobalImageTemplate).where(GlobalImageTemplate.id == template_id).with_for_update()
    )
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    if name is not None:
        normalized_name = name.strip()
        if len(normalized_name) < 2:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Template name is required",
            )
        template.name = normalized_name

    if category_id is not ...:
        if category_id is not None:
            category = await db.get(GlobalImageTemplateCategory, category_id)
            if category is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Template category not found",
                )
        template.category_id = category_id

    if sort_order is not None:
        template.sort_order = sort_order
    if is_active is not None:
        template.is_active = is_active

    if remove_image and image is None:
        template.image_object_key = None
        template.image_content_type = None
        template.image_thumbnail_object_key = None
        template.image_thumbnail_content_type = None
    elif image is not None:
        await save_global_image_template_upload(db, template, image, commit=False)

    await db.commit()
    await db.refresh(template)
    return template


async def deactivate_global_image_template(
    db: AsyncSession,
    template_id: UUID,
) -> GlobalImageTemplate:
    template = await db.scalar(
        select(GlobalImageTemplate).where(GlobalImageTemplate.id == template_id).with_for_update()
    )
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    template.is_active = False
    await db.commit()
    await db.refresh(template)
    return template
