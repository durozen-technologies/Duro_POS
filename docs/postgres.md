# Postgres

PostgreSQL is the relational database for the Billing System.

## Responsibilities

- Users and auth data
- Shops and shop accounts
- Items, Tamil names, categories, custom attributes, and allocation metadata
- Daily prices
- Inventory items, categories, allocations, and movement ledger
- Bills, bill items, payments, and receipts
- WhatsApp bot conversation and processed message data

## Production Compose Service

Defined in `docker-compose.prod.yml`:

```yaml
postgres:
  image: postgres:17-alpine
  profiles: ["infra"]
  ports:
    - "${POSTGRES_PUBLISH_PORT:-5432}:5432"
```

Important environment:

```env
POSTGRES_DB=duro_pos
POSTGRES_USER=postgres
POSTGRES_PASSWORD=...
POSTGRES_DATA_DIR=/home/ubuntu/pos-postgress/data
```

The backend connects with:

```env
DATABASE_URL=postgresql+asyncpg://postgres:<password>@postgres:5432/duro_pos
```

## Persistence

Production data is bind-mounted:

```text
/home/ubuntu/pos-postgress/data -> /var/lib/postgresql/data
```

The repo also has:

```text
postgres/data/.gitkeep
```

This is only a placeholder so the directory exists in Git.

## Healthcheck

```bash
pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

## Local Usage

If Postgres runs on the host, backend default local connection often looks like:

```env
DATABASE_URL=postgresql+asyncpg://postgres:root@localhost:5432/duro_pos
```

If backend runs inside Docker while Postgres runs on the host:

```env
DATABASE_URL=postgresql+asyncpg://postgres:root@host.docker.internal:5432/duro_pos
```

## Operational Notes

- Do not store item image bytes in Postgres.
- Use migrations for schema changes.
- Back up data before risky migrations or major deploys.
- If the production Postgres container is unhealthy, `scripts/deploy-prod.sh` refuses to restart it automatically.
- Recovery helpers live in `scripts/postgres-recover.sh`.

