"""Helpers to hide all-blank / all-zero columns in admin PDF report tables."""

from __future__ import annotations

import re
from collections.abc import Sequence

_BLANK_MONEY_RE = re.compile(r"^(?:rs\.?|₹)\s*0+(?:\.0+)?$", re.IGNORECASE)
_BLANK_QTY_RE = re.compile(
    r"^[-−]?\s*0+(?:\.0+)?(?:\s*(?:kg|unit|units|count))?$",
    re.IGNORECASE,
)
_BLANK_DASH_COUNT_RE = re.compile(r"^[-−]\s*count$", re.IGNORECASE)


def _line_is_blank_report_value(line: str) -> bool:
    normalized = re.sub(r"\s+", " ", line.replace("−", "-").replace("₹", "Rs.")).strip()
    if not normalized or normalized == "-":
        return True
    if _BLANK_MONEY_RE.fullmatch(normalized):
        return True
    if _BLANK_QTY_RE.fullmatch(normalized):
        return True
    if _BLANK_DASH_COUNT_RE.fullmatch(normalized):
        return True
    parts = re.split(r"[×x=]", normalized, flags=re.IGNORECASE)
    if len(parts) > 1:
        nonempty = [part.strip() for part in parts if part.strip()]
        return bool(nonempty) and all(_line_is_blank_report_value(part) for part in nonempty)
    return False


def _is_blank_report_cell(value: object) -> bool:
    """True when a PDF cell is empty, dash, or zero for column-hiding."""
    text = str(value if value is not None else "").replace("\r", "").strip()
    if not text:
        return True
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    if not lines:
        return True
    return all(_line_is_blank_report_value(line) for line in lines)


def _filter_empty_report_columns(
    headers: Sequence[str],
    rows: Sequence[Sequence[object]],
    *,
    always_keep: set[int],
    widths: Sequence[int] | None = None,
    aligns: Sequence[str] | None = None,
) -> tuple[list[str], list[list[object]], list[int] | None, list[str] | None, list[int]]:
    """Drop columns whose every data cell is blank; always_keep indices stay."""
    col_count = len(headers)
    kept: list[int] = []
    for idx in range(col_count):
        if idx in always_keep:
            kept.append(idx)
            continue
        if rows and all(
            _is_blank_report_cell(row[idx] if idx < len(row) else "") for row in rows
        ):
            continue
        if not rows:
            continue
        kept.append(idx)

    filtered_headers = [headers[i] for i in kept]
    filtered_rows = [[(row[i] if i < len(row) else "") for i in kept] for row in rows]
    filtered_widths = [int(widths[i]) for i in kept] if widths is not None else None
    filtered_aligns = [str(aligns[i]) for i in kept] if aligns is not None else None
    return filtered_headers, filtered_rows, filtered_widths, filtered_aligns, kept
