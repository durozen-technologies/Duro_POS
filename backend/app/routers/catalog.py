from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.storage import (
    StoredImagePayload,
    close_stored_image_stream,
    get_expense_item_image_response_payload,
    get_global_image_template_image_response_payload,
    get_inventory_item_image_response_payload,
    get_item_image_response_payload,
    image_response_headers,
    iter_stored_image_stream,
)
from app.db.session import get_platform_db
from app.db.tenant_session import get_tenant_db
from app.models import ExpenseItem, InventoryItem, Item
from app.models.global_image_template import GlobalImageTemplate

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
    db: AsyncSession = Depends(get_tenant_db),
    platform_db: AsyncSession = Depends(get_platform_db),
) -> Response:
    item = await db.get(Item, item_id)
    if item is None:
        return Response(status_code=404)

    request_id = str(request.scope.get("request_id", ""))
    payload = await get_item_image_response_payload(
        item,
        db=db,
        platform_db=platform_db,
        variant=variant,
        request_id=request_id,
    )
    headers = image_response_headers(payload)
    if request.headers.get("if-none-match") == headers.get("ETag"):
        if not isinstance(payload, StoredImagePayload):
            close_stored_image_stream(payload)
        return Response(status_code=304, headers=headers)

    if not isinstance(payload, StoredImagePayload):
        return StreamingResponse(
            iter_stored_image_stream(payload),
            media_type=payload.content_type,
            headers=headers,
        )

    return Response(
        content=payload.content,
        media_type=payload.content_type,
        headers=headers,
    )


@router.get(
    "/global-image-templates/{template_id}/image",
    summary="Get Global Image Template Image",
    responses={
        200: {"content": {"image/jpeg": {}, "image/png": {}, "image/webp": {}}},
    },
)
async def get_global_image_template_image(
    template_id: UUID,
    request: Request,
    variant: Literal["original", "thumb"] = Query(default="original"),
    platform_db: AsyncSession = Depends(get_platform_db),
) -> Response:
    template = await platform_db.get(GlobalImageTemplate, template_id)
    if template is None:
        return Response(status_code=404)

    payload = await get_global_image_template_image_response_payload(
        template,
        variant=variant,
    )
    headers = image_response_headers(payload)
    if request.headers.get("if-none-match") == headers.get("ETag"):
        if not isinstance(payload, StoredImagePayload):
            close_stored_image_stream(payload)
        return Response(status_code=304, headers=headers)

    if not isinstance(payload, StoredImagePayload):
        return StreamingResponse(
            iter_stored_image_stream(payload),
            media_type=payload.content_type,
            headers=headers,
        )

    return Response(
        content=payload.content,
        media_type=payload.content_type,
        headers=headers,
    )


@router.get(
    "/inventory-items/{item_id}/image",
    summary="Get Inventory Item Image",
    responses={
        200: {"content": {"image/jpeg": {}, "image/png": {}, "image/webp": {}}},
    },
)
async def get_inventory_item_image(
    item_id: UUID,
    request: Request,
    variant: Literal["original", "thumb"] = Query(default="original"),
    db: AsyncSession = Depends(get_tenant_db),
    platform_db: AsyncSession = Depends(get_platform_db),
) -> Response:
    item = await db.get(InventoryItem, item_id)
    if item is None:
        return Response(status_code=404)

    request_id = str(request.scope.get("request_id", ""))
    payload = await get_inventory_item_image_response_payload(
        item,
        db=db,
        platform_db=platform_db,
        variant=variant,
        request_id=request_id,
    )
    headers = image_response_headers(payload)
    if request.headers.get("if-none-match") == headers.get("ETag"):
        if not isinstance(payload, StoredImagePayload):
            close_stored_image_stream(payload)
        return Response(status_code=304, headers=headers)

    if not isinstance(payload, StoredImagePayload):
        return StreamingResponse(
            iter_stored_image_stream(payload),
            media_type=payload.content_type,
            headers=headers,
        )

    return Response(
        content=payload.content,
        media_type=payload.content_type,
        headers=headers,
    )


@router.get(
    "/expense-items/{item_id}/image",
    summary="Get Expense Item Image",
    responses={
        200: {"content": {"image/jpeg": {}, "image/png": {}, "image/webp": {}}},
    },
)
async def get_expense_item_image(
    item_id: UUID,
    request: Request,
    variant: Literal["original", "thumb"] = Query(default="original"),
    db: AsyncSession = Depends(get_tenant_db),
    platform_db: AsyncSession = Depends(get_platform_db),
) -> Response:
    item = await db.get(ExpenseItem, item_id)
    if item is None:
        return Response(status_code=404)

    request_id = str(request.scope.get("request_id", ""))
    payload = await get_expense_item_image_response_payload(
        item,
        db=db,
        platform_db=platform_db,
        variant=variant,
        request_id=request_id,
    )
    headers = image_response_headers(payload)
    if request.headers.get("if-none-match") == headers.get("ETag"):
        if not isinstance(payload, StoredImagePayload):
            close_stored_image_stream(payload)
        return Response(status_code=304, headers=headers)

    if not isinstance(payload, StoredImagePayload):
        return StreamingResponse(
            iter_stored_image_stream(payload),
            media_type=payload.content_type,
            headers=headers,
        )

    return Response(
        content=payload.content,
        media_type=payload.content_type,
        headers=headers,
    )
