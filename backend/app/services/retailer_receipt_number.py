"""Retailer receipt number formatting."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from app.core.timezone import to_ist


def invoice_receipt_number(sale_no: str) -> str:
    return f"RCT-{sale_no}"


def balance_receipt_number(
    sale_no: str, paid_at: datetime, *, payment_id: UUID | None = None
) -> str:
    """Embed payment datetime in receipt number for human-readable proof."""
    local = to_ist(paid_at)
    stamp = local.strftime("%Y%m%d-%H%M%S")
    base = f"RCT-{sale_no}-{stamp}"
    if payment_id is not None:
        return f"{base}-{str(payment_id)[:8]}"
    return base
