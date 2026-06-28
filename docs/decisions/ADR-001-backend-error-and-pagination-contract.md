# ADR-001: Backend error and pagination contract

## Status

Accepted

## Date

2026-06-28

## Context

The FastAPI backend exposes admin, shop, and auth APIs consumed by the web frontend and integration tests. Error responses historically used FastAPI's default `{ "detail": "..." }` shape. List endpoints mixed unpaginated full-table responses with newer cursor-paginated `/rows` + `/counts` pairs.

## Decision

1. **Errors:** HTTP exceptions are normalized to `{ "error": { "code", "message", "details?" } }` via a global handler in `app/main.py`. Machine-readable `code` values are derived from HTTP status and known message strings at the boundary.
2. **Pagination:** High-volume list surfaces use cursor pagination with `limit` plus stable cursor fields (`cursor_sort_order`, `cursor_name`, `cursor_id` or `cursor_created_at`, `cursor_id`). Responses include `has_more` and `next_cursor_*` fields. Both cursor fields must be supplied together or omitted.
3. **Removal:** Unpaginated `GET /api/v1/admin/inventory/items` is removed; consumers use `/inventory/items/rows` and `/inventory/items/counts`.

## Consequences

- Frontend and tests must not depend on removed unpaginated inventory list routes.
- Clients should read `error.code` for programmatic handling; `error.message` remains human-readable.
- New list endpoints should follow the cursor contract rather than returning unbounded arrays.
