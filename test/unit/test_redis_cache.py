"""Unit tests for Redis cache helpers (no live Redis required)."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.core.redis_cache import (
    hash_cache_parts,
    merge_redis_password_into_url,
    org_schema_cache_key,
    permission_cache_key,
    shop_bills_cache_key,
    shop_bootstrap_cache_key,
    shop_inventory_summary_cache_key,
)


class MergeRedisPasswordIntoUrlTests(unittest.TestCase):
    def test_embeds_password_when_missing(self) -> None:
        self.assertEqual(
            merge_redis_password_into_url("redis://127.0.0.1:6379/0", "root"),
            "redis://:root@127.0.0.1:6379/0",
        )

    def test_leaves_url_unchanged_when_password_already_present(self) -> None:
        url = "redis://:secret@127.0.0.1:6379/0"
        self.assertEqual(merge_redis_password_into_url(url, "other"), url)

    def test_noop_without_password(self) -> None:
        url = "redis://127.0.0.1:6379/0"
        self.assertEqual(merge_redis_password_into_url(url, None), url)
        self.assertEqual(merge_redis_password_into_url(url, ""), url)


class RedisCacheKeyTests(unittest.IsolatedAsyncioTestCase):
    def test_hash_cache_parts_stable(self) -> None:
        a = hash_cache_parts(1, "cash", None)
        b = hash_cache_parts(1, "cash", None)
        c = hash_cache_parts(1, "upi", None)
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        self.assertEqual(len(a), 16)

    def test_permission_and_org_schema_keys(self) -> None:
        org_id = uuid4()
        self.assertIn(":perm:user-1:3", permission_cache_key("user-1", 3))
        self.assertIn(f":org:{org_id}:schema", org_schema_cache_key(org_id))

    async def test_shop_keys_include_generation(self) -> None:
        shop_id = uuid4()
        with patch(
            "app.core.redis_cache._get_generation",
            new=AsyncMock(return_value=7),
        ):
            bills = await shop_bills_cache_key(shop_id, "abcd")
            boot = await shop_bootstrap_cache_key(shop_id, "2026-07-20")
            inv = await shop_inventory_summary_cache_key(
                shop_id, include_unallocated=False, active_allocations_only=True
            )
        self.assertIn(f":shop:{shop_id}:bills:v7:abcd", bills)
        self.assertIn(f":shop:{shop_id}:bootstrap:v7:2026-07-20", boot)
        self.assertIn(f":shop:{shop_id}:invsum:v7:01", inv)


if __name__ == "__main__":
    unittest.main()
