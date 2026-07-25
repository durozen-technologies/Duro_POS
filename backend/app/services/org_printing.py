"""Organization printing preference helpers."""

from __future__ import annotations

PRINTING_ENABLED_SETTING = "printing_enabled"


def printing_enabled_from_settings(settings: dict[str, object] | None) -> bool:
    """Return whether thermal printing is enabled for the organization.

    Missing key defaults to True so existing organizations keep print-required
    behavior until a super admin explicitly turns printing off.
    """
    raw = (settings or {}).get(PRINTING_ENABLED_SETTING)
    if raw is None:
        return True
    return bool(raw)
