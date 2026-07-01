# ADR-002: Multi-tenant tenancy and RBAC

## Status

Accepted — **tenancy section superseded by [ADR-003](ADR-003-schema-per-tenant.md)** (schema-per-tenant migration in progress). RBAC, JWT, RustFS, and bootstrap decisions below remain valid.

## Date

2026-06-30

## Context

Brolier 360 operated as a single-organization deployment: one global `ADMIN` managed all shop branches. The product must support multiple independent businesses (organizations), each with tenant admins and shop accounts, under a platform Super Admin control plane.

## Decision

1. **Tenancy:** *(superseded by ADR-003)* Shared PostgreSQL schema with `organization_id` row-level isolation. Organization = tenant; Shop = branch/outlet. Migrating to schema-per-tenant per ADR-003.
2. **Roles:** `SUPER_ADMIN` (platform, `organization_id = NULL`), `TENANT_ADMIN` (org-scoped; `ADMIN` is a deprecated alias), `SHOP_ACCOUNT` (unchanged).
3. **RBAC:** Static permission catalog (~15 codes) via `admin_roles` / `admin_user_roles`. Super admin has implicit `*`.
4. **Auth:** JWT carries `sub`, `role`, `org_id`, `perm_version`; permissions loaded server-side each request (Redis cache in Phase 3).
5. **RustFS:** Object keys prefixed `orgs/{organization_id}/...`.
6. **Bootstrap:** Super admin created via `uv run python -m app.cli bootstrap-super-admin`; public `POST /register` disabled in production.
7. **Database default name:** `brolier_360` for new installs; existing deployments may keep `meat_billing` until ops migrates.

## Consequences

- All tenant admin queries must filter by `organization_id` (Phase 4).
- Cross-tenant access returns 404 for shop UUIDs (IDOR-safe).
- WhatsApp Bot must resolve org from shop context.
- Username uniqueness is per-organization (partial indexes on `users`).

## Rollback

- Revert migration `0029_multi_tenant_foundation` only on empty/staging DBs.
- Production rollback: restore DB snapshot; do not downgrade in place after tenant data exists.
