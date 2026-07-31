"""Organization billing preference helpers."""

from __future__ import annotations

from typing import Literal

BILLING_ENTRY_MODE_SETTING = "billing_entry_mode"

BillingEntryMode = Literal["kg", "amount"]
DEFAULT_BILLING_ENTRY_MODE: BillingEntryMode = "kg"
_VALID_BILLING_ENTRY_MODES: frozenset[str] = frozenset({"kg", "amount"})


def billing_entry_mode_from_settings(
    settings: dict[str, object] | None,
) -> BillingEntryMode:
    """Return org shop-billing entry mode.

    Missing or invalid values default to ``kg`` so existing organizations keep
    quantity-first entry until a super admin selects amount mode.
    """
    raw = (settings or {}).get(BILLING_ENTRY_MODE_SETTING)
    if raw is None:
        return DEFAULT_BILLING_ENTRY_MODE
    value = str(raw).strip().lower()
    if value not in _VALID_BILLING_ENTRY_MODES:
        return DEFAULT_BILLING_ENTRY_MODE
    return value  # type: ignore[return-value]
