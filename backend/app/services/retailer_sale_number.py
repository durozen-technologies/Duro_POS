"""Retailer sale number helpers (RS- prefix sequence)."""

from __future__ import annotations

from datetime import UTC, datetime

from app.core.timezone import to_ist

RETAILER_SALE_NUMBER_PREFIX = "RS"
_MAX_SEQUENCE = 999_999


def retailer_sale_no_from_sequence(now: datetime, sequence: int) -> str:
    if sequence > _MAX_SEQUENCE:
        raise ValueError("Monthly retailer sale sequence limit reached")
    local = to_ist(now)
    return f"{RETAILER_SALE_NUMBER_PREFIX}-{local.year:04d}-{local.month:02d}-{sequence:06d}"


def format_retailer_sale_bill_no(sale_no: str) -> str:
    """Render RS-YYYY-MM-NNNNNN as MM-NNNNNN for compact report tables."""
    parts = sale_no.split("-")
    if len(parts) >= 4 and parts[0] == RETAILER_SALE_NUMBER_PREFIX:
        return f"{parts[2]}-{parts[3]}"
    return sale_no


def example_retailer_sale_number(*, now: datetime | None = None) -> str:
    moment = now or datetime.now(UTC)
    return retailer_sale_no_from_sequence(moment, 1)
