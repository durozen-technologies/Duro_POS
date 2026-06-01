from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.storage import get_item_image_response_payload, image_response_headers
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
    request: Request,
    variant: Literal["original", "thumb"] = Query(default="original"),
    db: AsyncSession = Depends(get_db),
) -> Response:
    item = await db.get(Item, item_id)
    if item is None:
        return Response(status_code=404)

    request_id = str(request.scope.get("request_id", ""))
    payload = await get_item_image_response_payload(
        item,
        db=db,
        variant=variant,
        request_id=request_id,
    )
    headers = image_response_headers(payload)
    if request.headers.get("if-none-match") == headers.get("ETag"):
        return Response(status_code=304, headers=headers)

    return Response(
        content=payload.content,
        media_type=payload.content_type,
        headers=headers,
    )
