from fastapi import APIRouter

from app.routers import admin, auth, catalog, health, shop

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(catalog.router)
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(admin.router, prefix="/admin")
api_router.include_router(shop.router, prefix="/shop")
