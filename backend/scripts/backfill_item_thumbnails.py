from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.database import close_database_connections, get_session_local
from app.db.storage import backfill_item_image_thumbnails

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def run_backfill(*, batch_size: int, max_items: int | None) -> int:
    processed_total = 0
    try:
        while max_items is None or processed_total < max_items:
            limit = batch_size
            if max_items is not None:
                limit = min(limit, max_items - processed_total)
            if limit <= 0:
                break

            async with get_session_local()() as db:
                processed_count = await backfill_item_image_thumbnails(db, limit=limit)
            if processed_count == 0:
                break
            processed_total += processed_count
            logger.info("Backfilled %s item thumbnail(s).", processed_total)

        return processed_total
    finally:
        await close_database_connections()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill missing RustFS item thumbnails.")
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--max-items", type=int, default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    processed_total = asyncio.run(
        run_backfill(batch_size=args.batch_size, max_items=args.max_items)
    )
    logger.info("Thumbnail backfill completed. processed=%s", processed_total)


if __name__ == "__main__":
    main()
