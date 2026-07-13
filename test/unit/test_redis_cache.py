import unittest

from app.core.redis_cache import merge_redis_password_into_url


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


if __name__ == "__main__":
    unittest.main()
