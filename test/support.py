from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("SECRET_KEY", "test-secret-key")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

from app.db.database import Base, seed_default_item_images, seed_defaults  # noqa: E402
from app.core.security import get_password_hash  # noqa: E402
from app.models import DailyPrice, Item, Shop, User, UserRole  # noqa: E402


class AsyncSessionAdapter:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, instance: Any) -> None:
        self._session.add(instance)

    def add_all(self, instances: list[Any]) -> None:
        self._session.add_all(instances)

    async def scalar(self, *args: Any, **kwargs: Any) -> Any:
        return self._session.scalar(*args, **kwargs)

    async def scalars(self, *args: Any, **kwargs: Any) -> Any:
        return self._session.scalars(*args, **kwargs)

    async def execute(self, *args: Any, **kwargs: Any) -> Any:
        return self._session.execute(*args, **kwargs)

    async def get(self, *args: Any, **kwargs: Any) -> Any:
        return self._session.get(*args, **kwargs)

    async def commit(self) -> None:
        self._session.commit()

    async def refresh(self, instance: Any) -> None:
        self._session.refresh(instance)

    async def flush(self) -> None:
        self._session.flush()

    async def close(self) -> None:
        self._session.close()


class DatabaseHarness:
    def __init__(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.database_path = Path(self._tmpdir.name) / "test.sqlite3"
        self.database_url = f"sqlite:///{self.database_path}"
        self.engine = create_engine(
            self.database_url,
            future=True,
            connect_args={"check_same_thread": False},
        )
        self.session_factory = sessionmaker(
            bind=self.engine,
            autoflush=False,
            expire_on_commit=False,
        )

    def reset_database(self) -> None:
        for table in reversed(Base.metadata.sorted_tables):
            table.drop(self.engine, checkfirst=True)
        for table in Base.metadata.sorted_tables:
            table.create(self.engine, checkfirst=True)
        session = self.session_factory()
        try:
            self.run(seed_defaults(AsyncSessionAdapter(session)))
            self.run(seed_default_item_images(AsyncSessionAdapter(session)))
        finally:
            session.close()

    def start(self) -> None:
        self.reset_database()

    def stop(self) -> None:
        self.engine.dispose()
        self._tmpdir.cleanup()

    def run(self, coro):
        return asyncio.run(coro)

    async def fetch_items(self) -> list[Item]:
        with self.session_factory() as session:
            result = session.scalars(
                select(Item).where(Item.is_active.is_(True)).order_by(Item.id)
            )
            return result.all()

    def build_price_entries(
        self, base_price: str = "100.00"
    ) -> list[dict[str, str | UUID]]:
        items = self.run(self.fetch_items())
        start = Decimal(base_price)
        entries: list[dict[str, str | UUID]] = []
        for index, item in enumerate(items):
            entries.append(
                {
                    "item_id": item.id,
                    "price_per_unit": str(start + Decimal(index)),
                }
            )
        return entries

    async def create_admin_user(
        self, username: str = "admin", password: str = "password123"
    ) -> User:
        with self.session_factory() as session:
            user = User(
                username=username,
                password_hash=get_password_hash(password),
                role=UserRole.ADMIN,
                is_active=True,
            )
            session.add(user)
            session.commit()
            session.refresh(user)
            return user

    async def create_shop_user(
        self,
        username: str = "ml1",
        password: str = "ml123",
        shop_name: str = "Main Shop",
        is_active: bool = True,
    ) -> tuple[User, Shop]:
        with self.session_factory() as session:
            user = User(
                username=username,
                password_hash=get_password_hash(password),
                role=UserRole.SHOP_ACCOUNT,
                is_active=is_active,
            )
            shop = Shop(
                name=shop_name,
                owner=user,
                is_active=is_active,
            )
            session.add_all([user, shop])
            session.commit()
            session.refresh(user)
            session.refresh(shop)
            return user, shop

    async def create_prices_for_shop(
        self,
        shop_id: UUID,
        price_date,
        prices_by_item_name: dict[str, str],
    ) -> list[DailyPrice]:
        with self.session_factory() as session:
            items = session.scalars(
                select(Item).where(Item.name.in_(tuple(prices_by_item_name.keys())))
            ).all()
            items_by_name = {item.name: item for item in items}
            prices: list[DailyPrice] = []
            for name, amount in prices_by_item_name.items():
                item = items_by_name[name]
                price = DailyPrice(
                    shop_id=shop_id,
                    item_id=item.id,
                    price_per_unit=Decimal(amount),
                    unit=item.base_unit,
                    price_date=price_date,
                )
                session.add(price)
                prices.append(price)
            session.commit()
            for price in prices:
                session.refresh(price)
            return prices


class BackendTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.harness = DatabaseHarness()
        cls.harness.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.harness.stop()

    def setUp(self) -> None:
        self.harness.reset_database()

    def run_async(self, coro):
        return self.harness.run(coro)
