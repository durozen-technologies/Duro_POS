"""Retailer receipt number formatting."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID


def invoice_receipt_number(sale_no: str) -> str:
    return f"RCT-{sale_no}"


def balance_receipt_number(sale_no: str, paid_at: datetime, *, payment_id: UUID | None = None) -> str:
    """Embed payment datetime in receipt number for human-readable proof."""
    if paid_at.tzinfo is None:
        paid_at = paid_at.replace(tzinfo=UTC)
    local = paid_at.astimezone(UTC)
    stamp = local.strftime("%Y%m%d-%H%M%S")
    base = f"RCT-{sale_no}-{stamp}"
    if payment_id is not None:
        return f"{base}-{str(payment_id)[:8]}"
    return base
