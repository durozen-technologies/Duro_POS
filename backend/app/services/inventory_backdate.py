from datetime import UTC, date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User
from app.models.enums import is_tenant_admin
from app.models.inventory_policy import InventoryBackdatePolicy

_ADMIN_MAX_BACKDATE_DAYS = 365


def _backdate_not_allowed(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail={"code": "BACKDATE_NOT_ALLOWED", "message": message},
    )


def assert_inventory_occurred_at_allowed(
    *,
    actor: User,
    occurred_at: datetime,
    policy: InventoryBackdatePolicy,
) -> None:
    now = datetime.now(UTC)
    if occurred_at.tzinfo is None:
        occurred_at = occurred_at.replace(tzinfo=UTC)
    else:
        occurred_at = occurred_at.astimezone(UTC)

    if occurred_at > now:
        raise _backdate_not_allowed("Inventory transaction time cannot be in the future")

    today = now.date()
    occurred_date = occurred_at.date()
    if occurred_date == today:
        return

    if is_tenant_admin(actor.role):
        oldest = today - timedelta(days=_ADMIN_MAX_BACKDATE_DAYS)
        if occurred_date < oldest:
            raise _backdate_not_allowed(
                f"Inventory transaction date cannot be more than {_ADMIN_MAX_BACKDATE_DAYS} days ago"
            )
        return

    if not policy.allow_shop_backdated_inventory:
        raise _backdate_not_allowed("Backdated inventory entry is not permitted for your shop")

    window_days = (
        policy.shop_backdate_window_days if policy.shop_backdate_window_days is not None else 0
    )
    earliest = today - timedelta(days=window_days)
    if occurred_date < earliest or occurred_date > today:
        raise _backdate_not_allowed(
            f"Inventory transaction date must be within the last {window_days} day(s)"
        )


def resolve_inventory_occurred_at(raw: datetime | None) -> datetime:
    if raw is None:
        return datetime.now(UTC)
    if raw.tzinfo is None:
        return raw.replace(tzinfo=UTC)
    return raw.astimezone(UTC)


async def prepare_inventory_occurred_at(
    db: AsyncSession,
    *,
    actor: User,
    raw: datetime | None,
) -> datetime:
    from app.services.inventory_policy import get_inventory_backdate_policy_row

    policy = await get_inventory_backdate_policy_row(db)
    occurred_at = resolve_inventory_occurred_at(raw)
    assert_inventory_occurred_at_allowed(actor=actor, occurred_at=occurred_at, policy=policy)
    return occurred_at
