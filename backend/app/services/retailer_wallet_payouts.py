"""Record cash/UPI payouts that clear retailer wallet credit."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ids import uuid7
from app.models import Retailer, RetailerWalletPayout, User
from app.schemas.retailers import RetailerWalletPayoutCreate, RetailerWalletPayoutRead

TWOPLACES = Decimal("0.01")


def _round_money(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


async def _lock_retailer(db: AsyncSession, retailer_id: UUID) -> Retailer:
    retailer = await db.scalar(
        select(Retailer).where(Retailer.id == retailer_id).with_for_update()
    )
    if retailer is None or not retailer.is_active:
        raise HTTPException(status_code=404, detail="Retailer not found")
    return retailer


def _payout_to_read(payout: RetailerWalletPayout) -> RetailerWalletPayoutRead:
    return RetailerWalletPayoutRead(
        id=payout.id,
        retailer_id=payout.retailer_id,
        cash_amount=payout.cash_amount,
        upi_amount=payout.upi_amount,
        total_paid=payout.total_paid,
        credit_balance_before=payout.credit_balance_before,
        credit_balance_after=payout.credit_balance_after,
        notes=payout.notes,
        recorded_by_user_id=payout.recorded_by_user_id,
        created_at=payout.created_at,
    )


async def record_retailer_wallet_payout(
    db: AsyncSession,
    actor: User,
    retailer_id: UUID,
    payload: RetailerWalletPayoutCreate,
) -> RetailerWalletPayoutRead:
    retailer = await _lock_retailer(db, retailer_id)
    cash_amount = _round_money(payload.cash_amount)
    upi_amount = _round_money(payload.upi_amount)
    total_paid = _round_money(cash_amount + upi_amount)

    if total_paid <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Payout amount must be greater than zero",
        )
    if total_paid > retailer.credit_balance:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Payout exceeds wallet credit ({retailer.credit_balance})",
        )

    credit_before = retailer.credit_balance
    credit_after = _round_money(credit_before - total_paid)
    retailer.credit_balance = credit_after

    payout = RetailerWalletPayout(
        id=uuid7(),
        retailer_id=retailer_id,
        cash_amount=cash_amount,
        upi_amount=upi_amount,
        total_paid=total_paid,
        credit_balance_before=credit_before,
        credit_balance_after=credit_after,
        notes=payload.notes,
        recorded_by_user_id=actor.id,
    )
    db.add(payout)
    await db.commit()
    await db.refresh(payout)
    return _payout_to_read(payout)
