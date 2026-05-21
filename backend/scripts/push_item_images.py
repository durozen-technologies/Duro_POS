import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def log(message: str) -> None:
    print(message, flush=True)


async def main() -> None:
    from app.db.database import initialize_database
    from app.db.storage import settings

    log("Starting item image push...")
    log(f"RustFS endpoint: {settings.rustfs_endpoint_url or 'not configured'}")
    log(f"RustFS bucket: {settings.rustfs_bucket_name}")
    log(
        "RustFS timeouts: "
        f"connect={settings.rustfs_connect_timeout_seconds}s, "
        f"read={settings.rustfs_read_timeout_seconds}s"
    )
    log("Initializing database...")
    await initialize_database()
    log("Database initialized and default item images synced.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        log(f"Push failed: {exc!r}")
        raise
