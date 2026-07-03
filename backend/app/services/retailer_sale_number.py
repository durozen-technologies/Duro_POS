"""Retailer sale number helpers (RS- prefix sequence)."""

from __future__ import annotations

from datetime import UTC, datetime

RETAILER_SALE_NUMBER_PREFIX = "RS"
_MAX_SEQUENCE = 999_999


def retailer_sale_no_from_sequence(now: datetime, sequence: int) -> str:
    if sequence > _MAX_SEQUENCE:
        raise ValueError("Monthly retailer sale sequence limit reached")
    return f"{RETAILER_SALE_NUMBER_PREFIX}-{now.year:04d}-{now.month:02d}-{sequence:06d}"


def example_retailer_sale_number(*, now: datetime | None = None) -> str:
    moment = now or datetime.now(UTC)
    return retailer_sale_no_from_sequence(moment, 1)
