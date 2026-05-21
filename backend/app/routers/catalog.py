from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.storage import get_item_image_response_payload
from app.models import Item

router = APIRouter(prefix="/catalog", tags=["Catalog"])


@router.get(
    "/items/{item_id}/image",
    summary="Get Item Image",
    responses={
        200: {"content": {"image/jpeg": {}, "image/png": {}, "image/webp": {}}},
    },
)
async def get_item_image(
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    item = await db.get(Item, item_id)
    if item is None:
        return Response(status_code=404)

    payload, content_type = await get_item_image_response_payload(item)
    return Response(
        content=payload,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )
