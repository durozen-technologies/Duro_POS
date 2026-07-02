from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.tenant_db import (
    resolve_schema_for_whatsapp_phone,
    tenant_session_for_shop,
)

settings = get_settings()
engine = create_async_engine(settings.database_url, echo=settings.sql_echo)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


@asynccontextmanager
async def shop_scoped_session(shop_id: UUID):
    async with SessionLocal() as session:
        async with tenant_session_for_shop(session, shop_id):
            yield session


@asynccontextmanager
async def whatsapp_user_scoped_session(phone_number: str):
    async with SessionLocal() as session:
        from backend.app.db.tenant_schema import set_search_path

        schema_name = await resolve_schema_for_whatsapp_phone(session, phone_number)
        if schema_name is None:
            raise LookupError(f"No tenant schema for WhatsApp user {phone_number}")
        await set_search_path(session, schema_name)
        try:
            yield session
        finally:
            await set_search_path(session, None)
