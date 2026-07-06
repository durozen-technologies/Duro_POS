from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ["RUSTFS_ENDPOINT_URL"] = ""
os.environ["RUSTFS_ACCESS_KEY_ID"] = ""
os.environ["RUSTFS_SECRET_ACCESS_KEY"] = ""

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

from app.db.database import Base  # noqa: E402
from app.core.security import get_password_hash  # noqa: E402
from app.models import BaseUnit, DailyPrice, Item, Organization, Shop, UnitType, User, UserRole  # noqa: E402

TEST_ITEM_DEFINITIONS = {
    "Chicken": {
        "tamil_name": "தோலுடன்",
        "unit_type": UnitType.WEIGHT,
        "base_unit": BaseUnit.KG,
        "sort_order": 10,
        "category": "Chicken",
    },
    "Duck": {
        "tamil_name": "வாத்து",
        "unit_type": UnitType.COUNT,
        "base_unit": BaseUnit.UNIT,
        "sort_order": 40,
        "category": "Duck",
    },
}


def _test_item_attributes(item_name: str) -> dict[str, object]:
    return TEST_ITEM_DEFINITIONS.get(
        item_name,
        {
            "tamil_name": item_name,
            "unit_type": UnitType.WEIGHT,
            "base_unit": BaseUnit.KG,
            "sort_order": 0,
            "category": None,
        },
    )


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

    async def run_sync(self, fn: Any, *args: Any, **kwargs: Any) -> Any:
        return fn(self._session, *args, **kwargs)

    async def get(self, *args: Any, **kwargs: Any) -> Any:
        return self._session.get(*args, **kwargs)

    async def commit(self) -> None:
        self._session.commit()

    async def rollback(self) -> None:
        self._session.rollback()

    async def delete(self, instance: Any) -> None:
        self._session.delete(instance)

    async def refresh(self, instance: Any, attribute_names: list[str] | None = None) -> None:
        if attribute_names is None:
            self._session.refresh(instance)
        else:
            self._session.refresh(instance, attribute_names=attribute_names)

    async def flush(self, objects: list[Any] | None = None) -> None:
        if objects is None:
            self._session.flush()
        else:
            self._session.flush(objects)

    def get_bind(self, *args: Any, **kwargs: Any) -> Any:
        return self._session.get_bind(*args, **kwargs)

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
        with self.session_factory() as session:
            session.add(Organization(name="Brolier 360 Default", slug="default", is_active=True))
            session.commit()

    def start(self) -> None:
        self.reset_database()

    def stop(self) -> None:
        self.engine.dispose()
        self._tmpdir.cleanup()

    def run(self, coro):
        return asyncio.run(coro)

    async def create_catalogue_items(
        self,
        item_names: tuple[str, ...] = ("Chicken", "Duck"),
    ) -> list[Item]:
        org = await self.create_default_organization()
        with self.session_factory() as session:
            existing_items = session.scalars(
                select(Item).where(
                    Item.name.in_(item_names),
                    Item.shop_id.is_(None),
                    Item.organization_id == org.id,
                )
            ).all()
            items_by_name = {item.name: item for item in existing_items}

            for item_name in item_names:
                if item_name in items_by_name:
                    continue

                attributes = _test_item_attributes(item_name)
                item = Item(
                    organization_id=org.id,
                    name=item_name,
                    tamil_name=str(attributes["tamil_name"]),
                    unit_type=attributes["unit_type"],
                    base_unit=attributes["base_unit"],
                    sort_order=int(attributes["sort_order"]),
                    category=attributes["category"],
                    is_active=True,
                )
                session.add(item)
                items_by_name[item_name] = item

            session.commit()
            for item in items_by_name.values():
                session.refresh(item)

            return [items_by_name[item_name] for item_name in item_names]

    async def create_items_for_shop(
        self,
        shop_id: UUID,
        item_names: tuple[str, ...] = ("Chicken", "Duck"),
    ) -> list[Item]:
        org = await self.create_default_organization()
        with self.session_factory() as session:
            shop = session.get(Shop, shop_id)
            org_id = shop.organization_id if shop else org.id
            existing_items = session.scalars(
                select(Item).where(Item.name.in_(item_names), Item.shop_id == shop_id)
            ).all()
            items_by_name = {item.name: item for item in existing_items}

            template_items = session.scalars(
                select(Item).where(
                    Item.name.in_(item_names),
                    Item.shop_id.is_(None),
                    Item.organization_id == org_id,
                )
            ).all()
            templates_by_name = {item.name: item for item in template_items}

            for item_name in item_names:
                if item_name in items_by_name:
                    continue

                template = templates_by_name.get(item_name)
                attributes = _test_item_attributes(item_name)
                item = Item(
                    organization_id=org_id,
                    shop_id=shop_id,
                    name=item_name,
                    tamil_name=template.tamil_name if template else str(attributes["tamil_name"]),
                    unit_type=template.unit_type if template else attributes["unit_type"],
                    base_unit=template.base_unit if template else attributes["base_unit"],
                    sort_order=template.sort_order if template else int(attributes["sort_order"]),
                    category=template.category if template else attributes["category"],
                    is_active=True,
                )
                session.add(item)
                items_by_name[item_name] = item

            session.commit()
            for item in items_by_name.values():
                session.refresh(item)

            return [items_by_name[item_name] for item_name in item_names]

    async def create_default_organization(
        self,
        name: str = "Brolier 360 Default",
        slug: str = "default",
    ) -> Organization:
        with self.session_factory() as session:
            org = session.scalar(select(Organization).where(Organization.slug == slug))
            if org is None:
                org = Organization(name=name, slug=slug, is_active=True)
                session.add(org)
                session.commit()
                session.refresh(org)
            return org

    async def create_admin_user(
        self, username: str = "admin", password: str = "password123"
    ) -> User:
        org = await self.create_default_organization()
        with self.session_factory() as session:
            user = User(
                username=username,
                password_hash=get_password_hash(password),
                role=UserRole.TENANT_ADMIN,
                organization_id=org.id,
                is_active=True,
            )
            session.add(user)
            session.commit()
            session.refresh(user)
            return user

    async def create_super_admin_user(
        self, username: str = "superadmin", password: str = "password123"
    ) -> User:
        with self.session_factory() as session:
            user = User(
                username=username,
                password_hash=get_password_hash(password),
                role=UserRole.SUPER_ADMIN,
                organization_id=None,
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
        org = await self.create_default_organization()
        with self.session_factory() as session:
            user = User(
                username=username,
                password_hash=get_password_hash(password),
                role=UserRole.SHOP_ACCOUNT,
                organization_id=org.id,
                is_active=is_active,
            )
            shop = Shop(
                name=shop_name,
                owner=user,
                organization_id=org.id,
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
        await self.create_items_for_shop(shop_id, tuple(prices_by_item_name.keys()))
        with self.session_factory() as session:
            items = session.scalars(
                select(Item).where(
                    Item.name.in_(tuple(prices_by_item_name.keys())),
                    Item.shop_id == shop_id,
                )
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
            if price_date == date.today():
                shop = session.get(Shop, shop_id)
                if shop is not None:
                    shop.daily_prices_published_on = price_date
                    session.commit()
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
        self._admin_user = None

    def ensure_admin_user(self):
        if self._admin_user is None:
            self._admin_user = self.run_async(self.harness.create_admin_user())
        return self._admin_user

    def run_async(self, coro):
        return self.harness.run(coro)
