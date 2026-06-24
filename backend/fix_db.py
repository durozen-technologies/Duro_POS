import asyncio

from sqlalchemy import text

from app.db.database import get_engine


async def main():
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE alembic_version SET version_num = 'fb0d2b791bbc'"))
        print("Updated alembic_version")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
