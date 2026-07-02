from fastapi import APIRouter

from app.routers import admin, auth, catalog, health, shop, super_admin

api_router = APIRouter()
api_router.include_router(health.router, tags=["Health"])
api_router.include_router(catalog.router, tags=["Catalog"])
api_router.include_router(auth.router, prefix="/auth", tags=["Auth"])
api_router.include_router(super_admin.router, prefix="/super-admin", tags=["Super Admin"])
api_router.include_router(admin.router, prefix="/admin", tags=["Admin"])
api_router.include_router(shop.router, prefix="/shop", tags=["Shop"])
