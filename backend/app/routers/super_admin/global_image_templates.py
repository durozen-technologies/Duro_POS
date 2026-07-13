from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_super_admin_context
from app.db.session import get_platform_db
from app.schemas.super_admin.global_image_templates import GlobalImageTemplateRead
from app.services.global_image_templates import (
    create_global_image_template,
    deactivate_global_image_template,
    list_active_global_image_templates,
    template_to_read,
    update_global_image_template,
)

router = APIRouter()


@router.get("/global-image-templates", response_model=list[GlobalImageTemplateRead])
async def list_global_image_templates(
    db: AsyncSession = Depends(get_platform_db),
    ctx=Depends(get_super_admin_context),
    active_only: bool = False,
) -> list[GlobalImageTemplateRead]:
    templates = await list_active_global_image_templates(db, active_only=not active_only)
    return [template_to_read(template) for template in templates]


@router.post(
    "/global-image-templates",
    response_model=GlobalImageTemplateRead,
    status_code=201,
)
async def create_global_image_template_endpoint(
    db: AsyncSession = Depends(get_platform_db),
    ctx=Depends(get_super_admin_context),
    name: str = Form(min_length=2, max_length=120),
    category_id: UUID | None = Form(default=None),
    sort_order: int = Form(default=0),
    is_active: bool = Form(default=True),
    image: UploadFile | None = File(default=None),
) -> GlobalImageTemplateRead:
    template = await create_global_image_template(
        db,
        name=name,
        category_id=category_id,
        sort_order=sort_order,
        is_active=is_active,
        image=image,
    )
    return template_to_read(template)


@router.patch("/global-image-templates/{template_id}", response_model=GlobalImageTemplateRead)
async def update_global_image_template_endpoint(
    template_id: UUID,
    db: AsyncSession = Depends(get_platform_db),
    ctx=Depends(get_super_admin_context),
    name: str | None = Form(default=None, min_length=2, max_length=120),
    category_id: UUID | None = Form(default=None),
    sort_order: int | None = Form(default=None),
    is_active: bool | None = Form(default=None),
    remove_image: bool = Form(default=False),
    image: UploadFile | None = File(default=None),
) -> GlobalImageTemplateRead:
    template = await update_global_image_template(
        db,
        template_id,
        name=name,
        category_id=category_id,
        sort_order=sort_order,
        is_active=is_active,
        image=image,
        remove_image=remove_image,
    )
    return template_to_read(template)


@router.delete("/global-image-templates/{template_id}", response_model=GlobalImageTemplateRead)
async def delete_global_image_template_endpoint(
    template_id: UUID,
    db: AsyncSession = Depends(get_platform_db),
    ctx=Depends(get_super_admin_context),
) -> GlobalImageTemplateRead:
    template = await deactivate_global_image_template(db, template_id)
    return template_to_read(template)
