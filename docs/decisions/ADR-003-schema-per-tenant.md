# ADR-003: Schema-per-tenant PostgreSQL isolation

## Status

Implemented (2026-07-01) — **public schema cutover complete** (migration `0034_public_schema_cutover`). Supersedes the **tenancy** section of [ADR-002](ADR-002-multi-tenant-tenancy-and-rbac.md). ADR-002 RBAC, JWT fields, RustFS prefixes, and bootstrap flows remain in force.

## Date

2026-06-30

## Context

Brolier 360 uses shared-schema row isolation (`organization_id` on tenant tables) per ADR-002. As tenant count and data volume grow, every hot query pays an `organization_id` filter and shares bloated composite indexes. PostgreSQL schema-per-tenant gives physical isolation without separate databases, while keeping a small **platform** schema for cross-tenant control-plane data.

Constraints:

- Preserve API contracts, JWT shape (`sub`, `role`, `org_id`, `perm_version`), frontend, and `backend.app.models` / `backend.app.schemas` shared with the WhatsApp Bot.
- Ship incrementally with rollback path; no big-bang cutover.
- SQLite unit tests must keep working (schema-per-tenant is Postgres-only).

## Decision

### Two-layer layout

**Platform schema (`public`)**

| Table | Role |
|-------|------|
| `organizations` | Tenant registry; includes canonical `schema_name` |
| `permissions` | Global static permission catalog |
| `users` | Super-admin accounts only (`organization_id IS NULL`) after full cutover |
| `user_auth_index` | Login resolver: `(username_lower, organization_id)` → `(schema_name, user_id)` |
| `audit_logs` | Super-admin / cross-tenant audit |
| `alembic_version` | Platform migration chain |

**Tenant schema (`tenant_<slug_normalized>`)**

All operational data per organization: `shops`, tenant `users`, `admin_roles*`, catalogue, inventory, billing, expenses, transfers, tenant `audit_logs`, `whatsapp_*`, `inventory_backdate_policy`, etc.

Cross-schema FKs (e.g. `users.organization_id → public.organizations`, `admin_role_permissions.permission_code → public.permissions`) are allowed; tenant sessions use `SET search_path TO <tenant_schema>, public`.

### Schema naming

- Deterministic: `tenant_` + slug with non-alphanumeric characters replaced by `_`, truncated to 63 characters (PostgreSQL identifier limit).
- Canonical value stored on `organizations.schema_name` (**NOT NULL** after cutover); never derive at runtime without DB confirmation.
- Unique index on `schema_name`.

### Public schema cutover (complete)

`public` is the **super-admin control plane only**. Migration `0034_public_schema_cutover`:

1. Backfills `organizations.schema_name` where missing
2. Purges tenant rows from `public.users` / `public.audit_logs`
3. Drops tenant operational table shells from `public`
4. Sets `organizations.schema_name NOT NULL`

Legacy orgs are migrated with `migrate-tenant-data` before deploying `0034`. Verify with `uv run python scripts/check_public_schema.py`.

### Session / `search_path`

- Tenant requests: `SET search_path TO <tenant_schema>, public`
- Platform-only (super-admin): `SET search_path TO public`
- Super-admin drilling into tenant data: tenant session for target org
- **Pool safety:** `RESET search_path` at transaction begin (`after_begin`); set explicitly per request. Never assume pooled connections retain path.

Org → schema mapping cached in Redis: `org:{id}:schema`, TTL ~5 minutes.

### Login routing (Phase 4)

1. Super admin: authenticate `public.users` where `role = SUPER_ADMIN`.
2. Optional `organization_slug` on login (backward compatible): resolve org → schema → tenant `users`.
3. Else: lookup `user_auth_index` by `username_lower`:
   - 0 matches → 401
   - 1 match → route to schema
   - 2+ matches → 409 "Organization required"
4. `user_auth_index` maintained on tenant user create/update/delete.

JWT unchanged; schema resolved server-side from `org_id`.

### Alembic

- **Platform chain:** `backend/migrations/` — organizations, auth index, super-admin DDL.
- **Tenant chain:** `backend/migrations/tenant/` — squashed baseline of tenant tables; `alembic_version` per tenant schema (`version_table_schema`).
- `TARGET_SCHEMA` env var selects tenant schema during tenant migrations.
- `migrate.py` (Phase 2+): platform + all tenants; `--schema` for single tenant.

### `organization_id` lifecycle

- **Phase 1–3:** Retained on tenant-schema tables for migration compatibility.
- **Phase 5:** Drop redundant `organization_id` columns and composite indexes inside tenant schemas; keep `org_id` in JWT and `organizations` in public.

### Performance guardrails

- No cross-schema scans on tenant hot paths.
- Super-admin org list counts: Redis / platform cache — no N-schema fan-out per page load (extend `super_org_counts_cache_key` pattern).
- Cursor pagination unchanged.

### WhatsApp Bot (Phase 4)

Resolve shop → org (public) → schema → tenant session before DB access.

## Implementation phases

| Phase | Scope |
|-------|--------|
| 0 | ADR-003 (this document) |
| 1 | Platform migration, `TenantSchemaRouter`, org provisioning for new orgs |
| 2 | Full Alembic CLI split (`migrate-tenants`, `--schema`) |
| 3 | Data migration CLI with dry-run |
| 4 | App layer: `get_tenant_db`, login/auth-index, remove legacy fallbacks — **complete** |
| 5 | Tenant Alembic `0002` chain; redundant `organization_id` filters removed in hot paths |
| 6 | Extended isolation tests, docs, CI baseline check — **public cutover + `check_public_schema.py`** |

## Rollback

1. Before cutover: full `pg_dump`.
2. If rollback needed: restore dump to shared-schema layout; revert application deploy.
3. Do not `DROP` shared backup tables until one production release cycle after successful cutover.

## Consequences

- Postgres required for schema-per-tenant features; SQLite tests skip provisioning paths.
- Connection pool + `search_path` discipline is mandatory ops knowledge.
- Two Alembic chains to maintain; tenant baseline must stay aligned with models (CI check in Phase 2).
- Slightly more complex org provisioning (schema create + tenant migrate).
