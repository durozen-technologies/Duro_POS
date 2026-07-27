"""Organization printing preference helpers."""

from __future__ import annotations

from typing import Literal

PRINTING_ENABLED_SETTING = "printing_enabled"
RECEIPT_PAPER_MM_SETTING = "receipt_paper_mm"

ReceiptPaperMm = Literal[58, 80]
DEFAULT_RECEIPT_PAPER_MM: ReceiptPaperMm = 58
_VALID_RECEIPT_PAPER_MM: frozenset[int] = frozenset({58, 80})


def printing_enabled_from_settings(settings: dict[str, object] | None) -> bool:
    """Return whether thermal printing is enabled for the organization.

    Missing key defaults to True so existing organizations keep print-required
    behavior until a super admin explicitly turns printing off.
    """
    raw = (settings or {}).get(PRINTING_ENABLED_SETTING)
    if raw is None:
        return True
    return bool(raw)


def receipt_paper_mm_from_settings(settings: dict[str, object] | None) -> ReceiptPaperMm:
    """Return org receipt paper width in mm.

    Missing or invalid values default to 58 so existing organizations keep the
    current thermal layout until a super admin selects 80mm.
    """
    raw = (settings or {}).get(RECEIPT_PAPER_MM_SETTING)
    if raw is None:
        return DEFAULT_RECEIPT_PAPER_MM
    try:
        value = int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return DEFAULT_RECEIPT_PAPER_MM
    if value not in _VALID_RECEIPT_PAPER_MM:
        return DEFAULT_RECEIPT_PAPER_MM
    return value  # type: ignore[return-value]
