import asyncio
from httpx import AsyncClient
from backend.app.auth import create_access_token
from backend.app.models import UserRole
import uuid

async def test():
    token = create_access_token(data={"sub": str(uuid.uuid4()), "role": UserRole.SHOP_ACCOUNT})
    async with AsyncClient(base_url="http://localhost:8000") as client:
        res = await client.get("/api/v1/shop/inventory/transfer-shops", headers={"Authorization": f"Bearer {token}"})
        print(f"Status: {res.status_code}")
        print(f"Body: {res.text}")

asyncio.run(test())
