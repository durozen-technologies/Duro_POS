"""Reference = https://github.com/python/cpython/blob/main/Lib/uuid.py"""

from __future__ import annotations

import os
import time
import uuid
from threading import Lock
from uuid import UUID

from sqlalchemy import Uuid

UUID_SQL_TYPE = Uuid(as_uuid=True)

_uuid7_lock = Lock()
_uuid7_last_timestamp_ms: int | None = None
_uuid7_last_counter = 0  # 42-bit counter


def _uuid7_get_counter_and_tail() -> tuple[int, int]:
    random_bytes = int.from_bytes(os.urandom(10))
    counter = (random_bytes >> 32) & 0x1FF_FFFF_FFFF
    tail = random_bytes & 0xFFFF_FFFF
    return counter, tail


def uuid7() -> UUID:
    """Generate an RFC 9562 UUIDv7 value.

    Python 3.14 exposes ``uuid.uuid7()`` in the standard library. This
    project targets Python 3.11+, so we provide a compatible fallback based
    on the standard-library UUIDv7 layout and monotonic counter strategy.
    """
    if hasattr(uuid, "uuid7"):
        return uuid.uuid7()

    timestamp_ms = time.time_ns() // 1_000_000

    global _uuid7_last_timestamp_ms, _uuid7_last_counter
    with _uuid7_lock:
        if _uuid7_last_timestamp_ms is None or timestamp_ms > _uuid7_last_timestamp_ms:
            counter, tail = _uuid7_get_counter_and_tail()
        else:
            if timestamp_ms < _uuid7_last_timestamp_ms:
                timestamp_ms = _uuid7_last_timestamp_ms + 1

            counter = _uuid7_last_counter + 1
            if counter > 0x3FF_FFFF_FFFF:
                timestamp_ms += 1
                counter, tail = _uuid7_get_counter_and_tail()
            else:
                tail = int.from_bytes(os.urandom(4))

        unix_ts_ms = timestamp_ms & 0xFFFF_FFFF_FFFF
        counter_hi = (counter >> 30) & 0x0FFF
        counter_lo = counter & 0x3FFF_FFFF
        tail &= 0xFFFF_FFFF

        value = unix_ts_ms << 80
        value |= counter_hi << 64
        value |= counter_lo << 32
        value |= tail
        value |= (0x7 << 76) | (0b10 << 62)

        _uuid7_last_timestamp_ms = timestamp_ms
        _uuid7_last_counter = counter

    return UUID(int=value)
