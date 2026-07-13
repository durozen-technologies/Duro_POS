from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_permission
from app.db.session import get_platform_db
from app.schemas.super_admin.global_image_templates import GlobalImageTemplateRead
from app.services.global_image_templates import list_active_global_image_templates, template_to_read

router = APIRouter(dependencies=[Depends(require_permission("catalogue.manage"))])


@router.get("/global-image-templates", response_model=list[GlobalImageTemplateRead])
async def browse_global_image_templates(
    db: AsyncSession = Depends(get_platform_db),
) -> list[GlobalImageTemplateRead]:
    templates = await list_active_global_image_templates(db, active_only=True)
    return [template_to_read(template) for template in templates]
