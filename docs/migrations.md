# Migrations

Database schema changes are managed with Alembic under `backend/migrations/`.

## Responsibilities

- Version relational schema changes
- Apply changes consistently in local and production environments
- Preserve production data
- Support legacy data transitions, including image migration away from Postgres bytes

## Key Files

```text
backend/alembic.ini
backend/migrate.py
backend/migrations/env.py
backend/migrations/script.py.mako
backend/migrations/versions/
backend/app/db/startup.py
```

## Deployment Entry Point

Use `backend/migrate.py` instead of running Alembic directly in deployment flows.

`migrate.py` does three important things:

1. Runs legacy image migration to RustFS when needed.
2. Runs `alembic upgrade head`.
3. Runs idempotent startup/data tasks from `backend/app/db/startup.py`.

## Local Command

```bash
cd backend
uv run python migrate.py
```

## Production Command

The production backend image runs migrations before starting Gunicorn through:

```text
backend/docker-entrypoint.sh
```

The deployment script can also run migrations before recreating the backend:

```text
scripts/deploy-prod.sh
```

## Adding a Migration

1. Update SQLAlchemy models and schemas.
2. Create an Alembic revision in `backend/migrations/versions/`.
3. Keep migrations reversible where practical.
4. Avoid destructive data changes unless the migration includes a safe data transition.
5. Run tests and migration checks.

Validation:

```bash
cd backend
uv run ruff check .
uv run --with pytest pytest ../test/
```

## Important Rules

- Do not reintroduce `image_data` bytes into Postgres.
- Item image metadata should use object keys and content types.
- Keep startup tasks idempotent.
- Use Postgres enum changes carefully; existing database enum labels may differ from API enum values.

