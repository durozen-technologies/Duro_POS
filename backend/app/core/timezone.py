"""Application timezone helpers. Business dates use IST (Asia/Kolkata)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def now_ist() -> datetime:
    return datetime.now(IST)


def today_ist() -> date:
    return now_ist().date()


def to_ist(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(IST)


def ist_midnight(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=IST)


def ist_day_bounds(day: date) -> tuple[datetime, datetime]:
    start = ist_midnight(day)
    return start, start + timedelta(days=1)


def ist_range_bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    return ist_midnight(start_date), ist_midnight(end_date) + timedelta(days=1)


def ist_month_bounds(day: date) -> tuple[datetime, datetime]:
    start = ist_midnight(date(day.year, day.month, 1))
    if day.month == 12:
        end = ist_midnight(date(day.year + 1, 1, 1))
    else:
        end = ist_midnight(date(day.year, day.month + 1, 1))
    return start, end


def ist_year_bounds(day: date) -> tuple[datetime, datetime]:
    start = ist_midnight(date(day.year, 1, 1))
    end = ist_midnight(date(day.year + 1, 1, 1))
    return start, end


def ist_week_bounds(day: date) -> tuple[datetime, datetime]:
    start = ist_midnight(day - timedelta(days=day.weekday()))
    return start, start + timedelta(days=7)


def ist_month_key(dt: datetime) -> str:
    local = to_ist(dt)
    return f"{local.year:04d}-{local.month:02d}"
