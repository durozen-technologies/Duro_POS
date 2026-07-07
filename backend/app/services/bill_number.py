"""Organization bill number prefix helpers."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from app.core.timezone import to_ist

BILL_NUMBER_PREFIX_SETTING = "bill_number_prefix"
DEFAULT_BILL_NUMBER_PREFIX = "SMB"
_MAX_SEQUENCE = 999_999
_PREFIX_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{0,19}$")


def normalize_bill_number_prefix(value: str) -> str:
    normalized = value.strip().upper()
    if not normalized:
        raise ValueError("Bill number prefix cannot be empty")
    if not _PREFIX_RE.fullmatch(normalized):
        raise ValueError(
            "Bill number prefix may only contain letters, numbers, and hyphens (max 20 characters)"
        )
    return normalized


def bill_number_prefix_from_settings(settings: dict[str, object] | None) -> str:
    raw = (settings or {}).get(BILL_NUMBER_PREFIX_SETTING)
    if raw is None or str(raw).strip() == "":
        return DEFAULT_BILL_NUMBER_PREFIX
    return normalize_bill_number_prefix(str(raw))


def bill_no_from_sequence(now: datetime, sequence: int, prefix: str) -> str:
    if sequence > _MAX_SEQUENCE:
        raise ValueError("Monthly bill sequence limit reached for this bill format")
    local = to_ist(now)
    return f"{prefix}-{local.year:04d}-{local.month:02d}-{sequence:06d}"


def example_bill_number(prefix: str, *, now: datetime | None = None) -> str:
    moment = now or datetime.now(UTC)
    return bill_no_from_sequence(moment, 1, prefix)
