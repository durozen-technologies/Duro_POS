from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory_policy import InventoryBackdatePolicy
from app.schemas.inventory_policy import InventoryBackdatePolicyRead, InventoryBackdatePolicyUpdate

_POLICY_ID = 1
_PRESET_WINDOWS = {0, 1, 3, 7, 30}


async def _get_or_create_policy_row(db: AsyncSession) -> InventoryBackdatePolicy:
    policy = await db.get(InventoryBackdatePolicy, _POLICY_ID)
    if policy is None:
        policy = InventoryBackdatePolicy(
            id=_POLICY_ID,
            allow_shop_backdated_inventory=False,
            shop_backdate_window_days=0,
        )
        db.add(policy)
        await db.commit()
        await db.refresh(policy)
    return policy


def _policy_to_read(policy: InventoryBackdatePolicy) -> InventoryBackdatePolicyRead:
    return InventoryBackdatePolicyRead(
        allow_shop_backdated_inventory=policy.allow_shop_backdated_inventory,
        shop_backdate_window_days=policy.shop_backdate_window_days,
    )


async def get_inventory_backdate_policy(db: AsyncSession) -> InventoryBackdatePolicyRead:
    policy = await _get_or_create_policy_row(db)
    return _policy_to_read(policy)


async def get_inventory_backdate_policy_row(db: AsyncSession) -> InventoryBackdatePolicy:
    return await _get_or_create_policy_row(db)


async def update_inventory_backdate_policy(
    db: AsyncSession,
    payload: InventoryBackdatePolicyUpdate,
) -> InventoryBackdatePolicyRead:
    window = payload.shop_backdate_window_days
    if window is not None and window not in _PRESET_WINDOWS and not (0 <= window <= 365):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="shop_backdate_window_days must be 0–365",
        )

    policy = await _get_or_create_policy_row(db)
    policy.allow_shop_backdated_inventory = payload.allow_shop_backdated_inventory
    policy.shop_backdate_window_days = window if payload.allow_shop_backdated_inventory else 0
    policy.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(policy)
    return _policy_to_read(policy)
