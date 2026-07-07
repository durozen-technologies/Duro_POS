from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.timezone import (
    IST,
    ist_day_bounds,
    ist_month_bounds,
    ist_month_key,
    ist_range_bounds,
    ist_week_bounds,
    ist_year_bounds,
    today_ist,
    to_ist,
)


def test_ist_day_bounds_use_ist_midnight() -> None:
    start, end = ist_day_bounds(date(2026, 7, 7))
    assert start.tzinfo == IST
    assert start.hour == 0
    assert end - start == timedelta(days=1)


def test_ist_range_bounds_are_exclusive_on_end() -> None:
    start, end = ist_range_bounds(date(2026, 7, 1), date(2026, 7, 3))
    assert start == datetime(2026, 7, 1, 0, 0, tzinfo=IST)
    assert end == datetime(2026, 7, 4, 0, 0, tzinfo=IST)


def test_ist_month_key_uses_ist_calendar_month() -> None:
    # 2026-06-30 20:00 UTC = 2026-07-01 01:30 IST
    moment = datetime(2026, 6, 30, 20, 0, tzinfo=UTC)
    assert ist_month_key(moment) == "2026-07"


def test_bill_number_uses_ist_month() -> None:
    from app.services.bill_number import bill_no_from_sequence

    moment = datetime(2026, 6, 30, 20, 0, tzinfo=UTC)
    assert bill_no_from_sequence(moment, 1, "SMB") == "SMB-2026-07-000001"


def test_to_ist_converts_naive_utc() -> None:
    moment = datetime(2026, 7, 7, 12, 0)
    local = to_ist(moment)
    assert local.tzinfo == IST
    assert local.hour == 17
    assert local.minute == 30
