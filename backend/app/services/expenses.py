from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ExpenseEntry, ExpenseItem, Shop, ShopExpenseAllocation
from app.services.tenant_query import resolve_organization_id
from app.schemas.expenses import (
    ExpenseEntryCreate,
    ExpenseEntryPage,
    ExpenseEntryRead,
    ExpenseEntryUpdate,
    ExpenseItemCounts,
    ExpenseItemCreate,
    ExpenseItemRead,
    ExpenseItemRowsPage,
    ExpenseItemUpdate,
    ShopExpenseAllocationBulkRead,
    ShopExpenseAllocationUpdate,
    ShopExpenseItemRead,
    ShopExpenseItemRowsPage,
    ShopExpenseItemsOrderRead,
)
from app.services.storage import (
    build_expense_item_image_path,
    build_expense_item_image_thumb_path,
    delete_item_image_storage,
    save_expense_item_image_upload,
)
from app.services.storage import (
    delete_expense_item_image as delete_expense_item_image_storage_record,
)


def _normalize_expense_name(raw_name: str) -> str:
    name = raw_name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Expense name is required")
    return name


def _normalize_tamil_name(raw_name: str) -> str:
    name = raw_name.strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Tamil expense name is required",
        )
    return name


def _normalize_note(raw_note: str | None) -> str | None:
    if raw_note is None:
        return None
    note = raw_note.strip()
    return note or None


async def _ensure_unique_expense_name(
    db: AsyncSession,
    name: str,
    *,
    organization_id: UUID | None = None,
    exclude_item_id: UUID | None = None,
) -> None:
    org_id = organization_id or await resolve_organization_id(db)
    filters = [
        func.lower(ExpenseItem.name) == name.lower(),
        ExpenseItem.organization_id == org_id,
    ]
    if exclude_item_id is not None:
        filters.append(ExpenseItem.id != exclude_item_id)
    existing_id = await db.scalar(select(ExpenseItem.id).where(*filters).limit(1))
    if existing_id is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Expense item name already exists")


def _cursor_filter(sort_expr, name_expr, id_expr, cursor_sort_order, cursor_name, cursor_id):
    if cursor_sort_order is None:
        return None
    if cursor_name is None or cursor_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Expense pagination cursor is incomplete",
        )
    normalized_name = cursor_name.lower()
    return or_(
        sort_expr > cursor_sort_order,
        and_(sort_expr == cursor_sort_order, name_expr > normalized_name),
        and_(sort_expr == cursor_sort_order, name_expr == normalized_name, id_expr > cursor_id),
    )


def _expense_item_to_read(
    item: ExpenseItem,
    *,
    allocated_shop_count: int = 0,
    entry_count: int = 0,
) -> ExpenseItemRead:
    return ExpenseItemRead(
        id=item.id,
        name=item.name,
        tamil_name=item.tamil_name,
        sort_order=item.sort_order,
        is_active=item.is_active,
        image_path=build_expense_item_image_path(item.id, item.image_object_key, item.image_content_type),
        image_thumb_path=build_expense_item_image_thumb_path(
            item.id,
            item.image_thumbnail_object_key,
            item.image_thumbnail_content_type,
            original_object_key=item.image_object_key,
        ),
        image_content_type=item.image_content_type,
        created_at=item.created_at,
        updated_at=item.updated_at,
        allocated_shop_count=allocated_shop_count,
        entry_count=entry_count,
        can_delete=allocated_shop_count == 0 and entry_count == 0,
    )


def _shop_expense_item_from_row(row) -> ShopExpenseItemRead:
    allocated_shop_count = int(row.allocated_shop_count or 0)
    entry_count = int(row.entry_count or 0)
    return ShopExpenseItemRead(
        id=row.id,
        name=row.name,
        tamil_name=row.tamil_name,
        sort_order=row.sort_order,
        is_active=row.is_active,
        image_path=build_expense_item_image_path(row.id, row.image_object_key, row.image_content_type),
        image_thumb_path=build_expense_item_image_thumb_path(
            row.id,
            row.image_thumbnail_object_key,
            row.image_thumbnail_content_type,
            original_object_key=row.image_object_key,
        ),
        image_content_type=row.image_content_type,
        created_at=row.created_at,
        updated_at=row.updated_at,
        allocated_shop_count=allocated_shop_count,
        entry_count=entry_count,
        can_delete=allocated_shop_count == 0 and entry_count == 0,
        allocated=bool(row.allocation_id),
        allocation_id=row.allocation_id,
        allocation_is_active=bool(row.allocation_is_active),
        allocation_sort_order=row.allocation_sort_order if row.allocation_sort_order is not None else row.sort_order,
    )


def _count_subqueries():
    allocation_counts = (
        select(
            ShopExpenseAllocation.expense_item_id.label("expense_item_id"),
            func.count(ShopExpenseAllocation.id).label("allocated_shop_count"),
        )
        .group_by(ShopExpenseAllocation.expense_item_id)
        .subquery()
    )
    entry_counts = (
        select(
            ExpenseEntry.expense_item_id.label("expense_item_id"),
            func.count(ExpenseEntry.id).label("entry_count"),
        )
        .group_by(ExpenseEntry.expense_item_id)
        .subquery()
    )
    return allocation_counts, entry_counts


async def list_expense_item_rows(
    db: AsyncSession,
    *,
    q: str | None = None,
    active: bool | None = None,
    limit: int = 50,
    cursor_sort_order: int | None = None,
    cursor_name: str | None = None,
    cursor_id: UUID | None = None,
) -> ExpenseItemRowsPage:
    allocation_counts, entry_counts = _count_subqueries()
    sort_name_expr = func.lower(ExpenseItem.name)
    filters = []
    if q:
        like_search = f"%{q.strip().lower()}%"
        filters.append(or_(sort_name_expr.like(like_search), func.lower(ExpenseItem.tamil_name).like(like_search)))
    if active is not None:
        filters.append(ExpenseItem.is_active.is_(active))
    cursor = _cursor_filter(ExpenseItem.sort_order, sort_name_expr, ExpenseItem.id, cursor_sort_order, cursor_name, cursor_id)
    if cursor is not None:
        filters.append(cursor)

    rows = (
        await db.execute(
            select(
                ExpenseItem,
                func.coalesce(allocation_counts.c.allocated_shop_count, 0).label("allocated_shop_count"),
                func.coalesce(entry_counts.c.entry_count, 0).label("entry_count"),
            )
            .outerjoin(allocation_counts, allocation_counts.c.expense_item_id == ExpenseItem.id)
            .outerjoin(entry_counts, entry_counts.c.expense_item_id == ExpenseItem.id)
            .where(*filters)
            .order_by(ExpenseItem.sort_order, sort_name_expr, ExpenseItem.id)
            .limit(limit + 1)
        )
    ).all()
    page_rows = rows[:limit]
    items = [
        _expense_item_to_read(row.ExpenseItem, allocated_shop_count=row.allocated_shop_count, entry_count=row.entry_count)
        for row in page_rows
    ]
    next_cursor_sort_order = next_cursor_name = next_cursor_id = None
    if len(rows) > limit and page_rows:
        last_item = page_rows[-1].ExpenseItem
        next_cursor_sort_order = last_item.sort_order
        next_cursor_name = last_item.name.lower()
        next_cursor_id = last_item.id
    return ExpenseItemRowsPage(
        items=items,
        limit=limit,
        has_more=len(rows) > limit,
        next_cursor_sort_order=next_cursor_sort_order,
        next_cursor_name=next_cursor_name,
        next_cursor_id=next_cursor_id,
    )


async def count_expense_items(db: AsyncSession, *, shop_id: UUID | None = None, q: str | None = None) -> ExpenseItemCounts:
    filters = []
    if q:
        like_search = f"%{q.strip().lower()}%"
        filters.append(or_(func.lower(ExpenseItem.name).like(like_search), func.lower(ExpenseItem.tamil_name).like(like_search)))
    total = int(await db.scalar(select(func.count(ExpenseItem.id)).where(*filters)) or 0)
    active = int(
        await db.scalar(select(func.count(ExpenseItem.id)).where(*filters, ExpenseItem.is_active.is_(True))) or 0
    )
    paused = total - active
    allocated = available = 0
    if shop_id is not None:
        allocated = int(
            await db.scalar(
                select(func.count(ShopExpenseAllocation.id))
                .join(ExpenseItem, ExpenseItem.id == ShopExpenseAllocation.expense_item_id)
                .where(*filters, ShopExpenseAllocation.shop_id == shop_id)
            )
            or 0
        )
        allocated_item_ids = select(ShopExpenseAllocation.expense_item_id).where(ShopExpenseAllocation.shop_id == shop_id)
        available = int(
            await db.scalar(
                select(func.count(ExpenseItem.id)).where(
                    *filters,
                    ExpenseItem.is_active.is_(True),
                    ExpenseItem.id.not_in(allocated_item_ids),
                )
            )
            or 0
        )
    return ExpenseItemCounts(all=total, active=active, paused=paused, allocated=allocated, available=available)


async def get_expense_item(db: AsyncSession, item_id: UUID) -> ExpenseItemRead:
    item = await db.get(ExpenseItem, item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense item not found")
    allocated_shop_count = int(
        await db.scalar(select(func.count(ShopExpenseAllocation.id)).where(ShopExpenseAllocation.expense_item_id == item_id)) or 0
    )
    entry_count = int(await db.scalar(select(func.count(ExpenseEntry.id)).where(ExpenseEntry.expense_item_id == item_id)) or 0)
    return _expense_item_to_read(item, allocated_shop_count=allocated_shop_count, entry_count=entry_count)


async def create_expense_item(
    db: AsyncSession, payload: ExpenseItemCreate, organization_id: UUID | None = None
) -> ExpenseItemRead:
    org_id = organization_id or await resolve_organization_id(db)
    name = _normalize_expense_name(payload.name)
    await _ensure_unique_expense_name(db, name, organization_id=org_id)
    item = ExpenseItem(
        name=name,
        tamil_name=_normalize_tamil_name(payload.tamil_name),
        sort_order=payload.sort_order,
        is_active=payload.is_active,
        organization_id=org_id,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _expense_item_to_read(item)


async def update_expense_item(db: AsyncSession, item_id: UUID, payload: ExpenseItemUpdate) -> ExpenseItemRead:
    item = await db.get(ExpenseItem, item_id, with_for_update=True)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense item not found")
    name = _normalize_expense_name(payload.name)
    if name.lower() != item.name.lower():
        await _ensure_unique_expense_name(db, name, exclude_item_id=item_id)
    item.name = name
    item.tamil_name = _normalize_tamil_name(payload.tamil_name)
    item.sort_order = payload.sort_order
    item.is_active = payload.is_active
    await db.commit()
    await db.refresh(item)
    return await get_expense_item(db, item.id)


async def delete_expense_item(db: AsyncSession, item_id: UUID) -> None:
    item = await db.get(ExpenseItem, item_id, with_for_update=True)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense item not found")
    has_allocation = await db.scalar(
        select(ShopExpenseAllocation.id).where(ShopExpenseAllocation.expense_item_id == item_id).limit(1)
    )
    if has_allocation is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete an allocated expense item")
    has_entry = await db.scalar(select(ExpenseEntry.id).where(ExpenseEntry.expense_item_id == item_id).limit(1))
    if has_entry is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot delete an expense item with history")
    image_object_key = item.image_object_key
    thumbnail_object_key = item.image_thumbnail_object_key
    await db.delete(item)
    await db.commit()
    await delete_item_image_storage(image_object_key, thumbnail_object_key)


async def upload_expense_item_image(db: AsyncSession, item_id: UUID, image: UploadFile) -> ExpenseItemRead:
    item = await db.scalar(select(ExpenseItem).where(ExpenseItem.id == item_id).with_for_update())
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense item not found")
    await save_expense_item_image_upload(db, item, image)
    return await get_expense_item(db, item_id)


async def remove_expense_item_image(db: AsyncSession, item_id: UUID) -> ExpenseItemRead:
    await delete_expense_item_image_storage_record(db, item_id)
    return await get_expense_item(db, item_id)


def _shop_expense_rows_query(
    shop: Shop,
    *,
    allocated_only: bool,
    q: str | None = None,
    active: bool | None = None,
    item_active: bool | None = None,
):
    allocation_counts, entry_counts = _count_subqueries()
    sort_name_expr = func.lower(ExpenseItem.name)
    filters = []
    if q:
        like_search = f"%{q.strip().lower()}%"
        filters.append(or_(sort_name_expr.like(like_search), func.lower(ExpenseItem.tamil_name).like(like_search)))
    if active is not None:
        filters.append(ShopExpenseAllocation.is_active.is_(active))
    if item_active is not None:
        filters.append(ExpenseItem.is_active.is_(item_active))
    if allocated_only:
        filters.append(ShopExpenseAllocation.id.is_not(None))
    return (
        select(
            ExpenseItem.id,
            ExpenseItem.name,
            ExpenseItem.tamil_name,
            ExpenseItem.sort_order,
            ExpenseItem.is_active,
            ExpenseItem.image_object_key,
            ExpenseItem.image_content_type,
            ExpenseItem.image_thumbnail_object_key,
            ExpenseItem.image_thumbnail_content_type,
            ExpenseItem.created_at,
            ExpenseItem.updated_at,
            ShopExpenseAllocation.id.label("allocation_id"),
            ShopExpenseAllocation.is_active.label("allocation_is_active"),
            ShopExpenseAllocation.sort_order.label("allocation_sort_order"),
            func.coalesce(allocation_counts.c.allocated_shop_count, 0).label("allocated_shop_count"),
            func.coalesce(entry_counts.c.entry_count, 0).label("entry_count"),
        )
        .outerjoin(
            ShopExpenseAllocation,
            and_(
                ShopExpenseAllocation.expense_item_id == ExpenseItem.id,
                ShopExpenseAllocation.shop_id == shop.id,
            ),
        )
        .outerjoin(allocation_counts, allocation_counts.c.expense_item_id == ExpenseItem.id)
        .outerjoin(entry_counts, entry_counts.c.expense_item_id == ExpenseItem.id)
        .where(*filters)
    )


async def list_shop_expense_item_rows(
    db: AsyncSession,
    shop: Shop,
    *,
    q: str | None = None,
    active: bool | None = None,
    item_active: bool | None = None,
    limit: int = 50,
    cursor_sort_order: int | None = None,
    cursor_name: str | None = None,
    cursor_id: UUID | None = None,
) -> ShopExpenseItemRowsPage:
    sort_name_expr = func.lower(ExpenseItem.name)
    sort_order_expr = ShopExpenseAllocation.sort_order
    query = _shop_expense_rows_query(
        shop,
        allocated_only=True,
        q=q,
        active=active,
        item_active=item_active,
    )
    cursor = _cursor_filter(sort_order_expr, sort_name_expr, ExpenseItem.id, cursor_sort_order, cursor_name, cursor_id)
    if cursor is not None:
        query = query.where(cursor)
    rows = (
        await db.execute(
            query.order_by(sort_order_expr, sort_name_expr, ExpenseItem.id).limit(limit + 1)
        )
    ).all()
    page_rows = rows[:limit]
    items = [_shop_expense_item_from_row(row) for row in page_rows]
    next_cursor_sort_order = next_cursor_name = next_cursor_id = None
    if len(rows) > limit and page_rows:
        last_row = page_rows[-1]
        next_cursor_sort_order = last_row.allocation_sort_order
        next_cursor_name = last_row.name.lower()
        next_cursor_id = last_row.id
    return ShopExpenseItemRowsPage(
        items=items,
        limit=limit,
        has_more=len(rows) > limit,
        next_cursor_sort_order=next_cursor_sort_order,
        next_cursor_name=next_cursor_name,
        next_cursor_id=next_cursor_id,
    )


async def list_shop_expense_candidate_rows(
    db: AsyncSession,
    shop: Shop,
    *,
    q: str | None = None,
    limit: int = 50,
    cursor_sort_order: int | None = None,
    cursor_name: str | None = None,
    cursor_id: UUID | None = None,
) -> ExpenseItemRowsPage:
    allocated_item_ids = select(ShopExpenseAllocation.expense_item_id).where(ShopExpenseAllocation.shop_id == shop.id)
    sort_name_expr = func.lower(ExpenseItem.name)
    filters = [ExpenseItem.is_active.is_(True), ExpenseItem.id.not_in(allocated_item_ids)]
    if q:
        like_search = f"%{q.strip().lower()}%"
        filters.append(or_(sort_name_expr.like(like_search), func.lower(ExpenseItem.tamil_name).like(like_search)))
    cursor = _cursor_filter(ExpenseItem.sort_order, sort_name_expr, ExpenseItem.id, cursor_sort_order, cursor_name, cursor_id)
    if cursor is not None:
        filters.append(cursor)
    rows = (
        await db.scalars(
            select(ExpenseItem)
            .where(*filters)
            .order_by(ExpenseItem.sort_order, sort_name_expr, ExpenseItem.id)
            .limit(limit + 1)
        )
    ).all()
    page_rows = rows[:limit]
    next_cursor_sort_order = next_cursor_name = next_cursor_id = None
    if len(rows) > limit and page_rows:
        last_item = page_rows[-1]
        next_cursor_sort_order = last_item.sort_order
        next_cursor_name = last_item.name.lower()
        next_cursor_id = last_item.id
    return ExpenseItemRowsPage(
        items=[_expense_item_to_read(item) for item in page_rows],
        limit=limit,
        has_more=len(rows) > limit,
        next_cursor_sort_order=next_cursor_sort_order,
        next_cursor_name=next_cursor_name,
        next_cursor_id=next_cursor_id,
    )


async def _get_shop_expense_item_read(db: AsyncSession, shop: Shop, item_id: UUID) -> ShopExpenseItemRead:
    row = (
        await db.execute(_shop_expense_rows_query(shop, allocated_only=False).where(ExpenseItem.id == item_id).limit(1))
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense item not found")
    return _shop_expense_item_from_row(row)


async def _next_allocation_sort_order(db: AsyncSession, shop: Shop) -> int:
    current_max = await db.scalar(
        select(func.max(ShopExpenseAllocation.sort_order)).where(ShopExpenseAllocation.shop_id == shop.id)
    )
    return int(current_max or 0) + 10


async def allocate_shop_expense_item(db: AsyncSession, shop: Shop, item_id: UUID) -> ShopExpenseItemRead:
    item = await db.get(ExpenseItem, item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense item not found")
    if not item.is_active:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Inactive expense items cannot be allocated")
    existing = await db.scalar(
        select(ShopExpenseAllocation).where(
            ShopExpenseAllocation.shop_id == shop.id,
            ShopExpenseAllocation.expense_item_id == item_id,
        )
    )
    if existing is None:
        db.add(
            ShopExpenseAllocation(
                shop_id=shop.id,
                expense_item_id=item_id,
                sort_order=await _next_allocation_sort_order(db, shop),
            )
        )
        await db.commit()
    return await _get_shop_expense_item_read(db, shop, item_id)


async def allocate_shop_expense_items(
    db: AsyncSession,
    shop: Shop,
    item_ids: list[UUID],
) -> ShopExpenseAllocationBulkRead:
    requested_ids = list(dict.fromkeys(item_ids))
    if not requested_ids:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="No expense items selected")
    active_ids = set(
        (
            await db.scalars(
                select(ExpenseItem.id).where(
                    ExpenseItem.id.in_(requested_ids),
                    ExpenseItem.is_active.is_(True),
                )
            )
        ).all()
    )
    missing_ids = set(requested_ids) - active_ids
    if missing_ids:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Only active expense items can be allocated")
    existing_ids = set(
        (
            await db.scalars(
                select(ShopExpenseAllocation.expense_item_id).where(
                    ShopExpenseAllocation.shop_id == shop.id,
                    ShopExpenseAllocation.expense_item_id.in_(requested_ids),
                )
            )
        ).all()
    )
    next_sort_order = await _next_allocation_sort_order(db, shop)
    new_ids = [item_id for item_id in requested_ids if item_id not in existing_ids]
    for index, item_id in enumerate(new_ids):
        db.add(
            ShopExpenseAllocation(
                shop_id=shop.id,
                expense_item_id=item_id,
                sort_order=next_sort_order + index * 10,
            )
        )
    await db.commit()
    return ShopExpenseAllocationBulkRead(
        expense_item_ids=requested_ids,
        allocated_count=len(new_ids),
        already_allocated_count=len(existing_ids),
    )


async def update_shop_expense_allocation(
    db: AsyncSession,
    shop: Shop,
    item_id: UUID,
    payload: ShopExpenseAllocationUpdate,
) -> ShopExpenseItemRead:
    allocation = await db.scalar(
        select(ShopExpenseAllocation)
        .where(
            ShopExpenseAllocation.shop_id == shop.id,
            ShopExpenseAllocation.expense_item_id == item_id,
        )
        .with_for_update()
    )
    if allocation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense allocation not found")
    if payload.is_active is not None:
        allocation.is_active = payload.is_active
    if payload.sort_order is not None:
        allocation.sort_order = payload.sort_order
    await db.commit()
    return await _get_shop_expense_item_read(db, shop, item_id)


async def deallocate_shop_expense_item(db: AsyncSession, shop: Shop, item_id: UUID) -> ShopExpenseItemRead:
    allocation = await db.scalar(
        select(ShopExpenseAllocation).where(
            ShopExpenseAllocation.shop_id == shop.id,
            ShopExpenseAllocation.expense_item_id == item_id,
        )
    )
    if allocation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense allocation not found")
    await db.delete(allocation)
    await db.commit()
    return await _get_shop_expense_item_read(db, shop, item_id)


async def update_shop_expense_items_order(
    db: AsyncSession,
    shop: Shop,
    item_ids: list[UUID],
) -> ShopExpenseItemsOrderRead:
    ordered_ids = list(item_ids)
    unique_ids = set(ordered_ids)
    if len(unique_ids) != len(ordered_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Order payload contains duplicate expense items")
    allocations = (
        await db.scalars(
            select(ShopExpenseAllocation)
            .where(ShopExpenseAllocation.shop_id == shop.id)
            .with_for_update()
        )
    ).all()
    allocations_by_item_id = {allocation.expense_item_id: allocation for allocation in allocations}
    allocated_ids = set(allocations_by_item_id)
    if unique_ids != allocated_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Order payload must include every allocated expense item exactly once",
        )
    for index, item_id in enumerate(ordered_ids, start=1):
        allocations_by_item_id[item_id].sort_order = index * 10
    await db.commit()
    return ShopExpenseItemsOrderRead(expense_item_ids=ordered_ids)


async def list_current_shop_expense_items(
    db: AsyncSession,
    shop: Shop,
    *,
    q: str | None = None,
    limit: int = 50,
    cursor_sort_order: int | None = None,
    cursor_name: str | None = None,
    cursor_id: UUID | None = None,
) -> ShopExpenseItemRowsPage:
    page = await list_shop_expense_item_rows(
        db,
        shop,
        q=q,
        active=True,
        item_active=True,
        limit=limit,
        cursor_sort_order=cursor_sort_order,
        cursor_name=cursor_name,
        cursor_id=cursor_id,
    )
    return page


def _expense_entry_to_read(
    *,
    entry: ExpenseEntry,
    shop_name: str,
    item: ExpenseItem,
) -> ExpenseEntryRead:
    return ExpenseEntryRead(
        id=entry.id,
        shop_id=entry.shop_id,
        shop_name=shop_name,
        expense_item_id=entry.expense_item_id,
        expense_name=entry.expense_name,
        expense_tamil_name=entry.expense_tamil_name,
        image_path=build_expense_item_image_path(item.id, item.image_object_key, item.image_content_type),
        image_thumb_path=build_expense_item_image_thumb_path(
            item.id,
            item.image_thumbnail_object_key,
            item.image_thumbnail_content_type,
            original_object_key=item.image_object_key,
        ),
        image_content_type=item.image_content_type,
        amount=entry.amount,
        spent_at=entry.spent_at,
        note=entry.note,
        created_at=entry.created_at,
    )


def _date_range_filters(
    range_start_date: date | None,
    range_end_date: date | None,
) -> list[object]:
    filters = []
    if range_start_date is not None:
        filters.append(ExpenseEntry.spent_at >= datetime.combine(range_start_date, time.min, tzinfo=UTC))
    if range_end_date is not None:
        filters.append(ExpenseEntry.spent_at < datetime.combine(range_end_date + timedelta(days=1), time.min, tzinfo=UTC))
    return filters


async def create_shop_expense_entry(
    db: AsyncSession,
    shop: Shop,
    payload: ExpenseEntryCreate,
) -> ExpenseEntryRead:
    row = (
        await db.execute(
            select(ExpenseItem, ShopExpenseAllocation)
            .join(
                ShopExpenseAllocation,
                and_(
                    ShopExpenseAllocation.expense_item_id == ExpenseItem.id,
                    ShopExpenseAllocation.shop_id == shop.id,
                ),
            )
            .where(
                ExpenseItem.id == payload.expense_item_id,
                ExpenseItem.is_active.is_(True),
                ShopExpenseAllocation.is_active.is_(True),
            )
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Expense item is not active for this branch")
    item = row.ExpenseItem
    spent_at = payload.spent_at or datetime.now(UTC)
    entry = ExpenseEntry(
        shop_id=shop.id,
        expense_item_id=item.id,
        expense_name=item.name,
        expense_tamil_name=item.tamil_name,
        amount=Decimal(payload.amount).quantize(Decimal("0.01")),
        spent_at=spent_at,
        note=_normalize_note(payload.note),
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return _expense_entry_to_read(entry=entry, shop_name=shop.name, item=item)


async def update_expense_entry(
    db: AsyncSession,
    entry_id: UUID,
    payload: ExpenseEntryUpdate,
) -> ExpenseEntryRead:
    entry = await db.get(ExpenseEntry, entry_id, with_for_update=True)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense entry not found")
    entry.amount = Decimal(payload.amount).quantize(Decimal("0.01"))
    entry.spent_at = payload.spent_at
    entry.note = _normalize_note(payload.note)
    await db.commit()
    await db.refresh(entry)
    row = (
        await db.execute(
            select(Shop.name.label("shop_name"), ExpenseItem)
            .select_from(ExpenseEntry)
            .join(Shop, Shop.id == ExpenseEntry.shop_id)
            .join(ExpenseItem, ExpenseItem.id == ExpenseEntry.expense_item_id)
            .where(ExpenseEntry.id == entry_id)
        )
    ).one()
    return _expense_entry_to_read(entry=entry, shop_name=row.shop_name, item=row.ExpenseItem)


async def list_expense_entries(
    db: AsyncSession,
    *,
    shop_id: UUID | None = None,
    range_start_date: date | None = None,
    range_end_date: date | None = None,
    limit: int = 50,
    cursor_spent_at: datetime | None = None,
    cursor_id: UUID | None = None,
) -> ExpenseEntryPage:
    base_filters = _date_range_filters(range_start_date, range_end_date)
    if shop_id is not None:
        base_filters.append(ExpenseEntry.shop_id == shop_id)
    cursor_filters = []
    if cursor_spent_at is not None:
        if cursor_id is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Expense history cursor is incomplete")
        cursor_filters.append(
            or_(
                ExpenseEntry.spent_at < cursor_spent_at,
                and_(ExpenseEntry.spent_at == cursor_spent_at, ExpenseEntry.id < cursor_id),
            )
        )
    total_amount = await db.scalar(
        select(func.coalesce(func.sum(ExpenseEntry.amount), Decimal("0.00"))).where(*base_filters)
    )

    rows = (
        await db.execute(
            select(
                ExpenseEntry,
                Shop.name.label("shop_name"),
                ExpenseItem,
            )
            .join(Shop, Shop.id == ExpenseEntry.shop_id)
            .join(ExpenseItem, ExpenseItem.id == ExpenseEntry.expense_item_id)
            .where(*base_filters, *cursor_filters)
            .order_by(ExpenseEntry.spent_at.desc(), ExpenseEntry.id.desc())
            .limit(limit + 1)
        )
    ).all()
    page_rows = rows[:limit]
    items = [
        _expense_entry_to_read(
            entry=row.ExpenseEntry,
            shop_name=row.shop_name,
            item=row.ExpenseItem,
        )
        for row in page_rows
    ]
    next_cursor_spent_at = next_cursor_id = None
    if len(rows) > limit and page_rows:
        last_entry = page_rows[-1].ExpenseEntry
        next_cursor_spent_at = last_entry.spent_at
        next_cursor_id = last_entry.id
    return ExpenseEntryPage(
        items=items,
        limit=limit,
        has_more=len(rows) > limit,
        total_amount=Decimal(total_amount or 0).quantize(Decimal("0.01")),
        next_cursor_spent_at=next_cursor_spent_at,
        next_cursor_id=next_cursor_id,
    )
