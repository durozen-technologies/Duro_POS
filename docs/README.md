# Billing System Documentation

This directory documents the main parts of the Billing System. It is meant to be the first place to look when onboarding, debugging, deploying, or changing the application.

## Application Summary

The Billing System is a mobile-first POS application for meat shop billing. It has:

- a FastAPI backend for auth, shops, items, prices, inventory, bills, receipts, analytics, and image storage
- an Expo React Native frontend for admin and shop users
- PostgreSQL for relational data
- RustFS for S3-compatible item image storage
- Alembic migrations managed through `backend/migrate.py`
- Caddy as the active HTTPS reverse proxy
- an Nginx configuration kept as an alternate or older proxy option
- a FastAPI WhatsApp bot that reuses backend models and schemas for sales reporting

## Core Business Rules

These rules are part of the application contract:

- Checkout must follow `preview -> print -> commit`. Receipt data is committed only after successful printing.
- Checkout payment is exact payment only. Cash plus UPI must equal the bill total.
- Item images live in RustFS using `image_object_key` and `image_content_type`. Do not store image bytes in Postgres.
- `tamil_name` is required for item admin flows and is first-class data for shop display and receipts.
- Shared models and schemas belong in `backend.app`; the WhatsApp bot imports them instead of duplicating them.

## Component Docs

- [Frontend](frontend.md)
- [Backend](backend.md)
- [Migrations](migrations.md)
- [Caddy](caddy.md)
- [Nginx](nginx.md)
- [Postgres](postgres.md)
- [RustFS](rustfs.md)
- [WhatsApp Bot](whatsapp.md)

## High-Level Architecture

```text
Expo app
  |
  | HTTPS /api/v1
  v
Caddy
  |
  | internal Docker DNS: backend:8000
  v
FastAPI backend
  |                         |
  | async SQLAlchemy         | S3-compatible API
  v                         v
PostgreSQL               RustFS

WhatsApp Bot
  |
  | imports backend.app models and schemas
  v
PostgreSQL shared domain
```

## Main Validation Commands

```bash
# Backend lint and tests
cd backend
uv run ruff check .
uv run --with pytest pytest ../test/

# Frontend typecheck
cd frontend
npm run typecheck
```

## Important Repo Paths

```text
backend/                 FastAPI app, models, schemas, services, migrations
frontend/                Expo React Native app
WhatsApp Bot/            WhatsApp sales bot FastAPI app
backend/migrations/      Alembic revision files
backend/migrate.py       Deployment migration entrypoint
caddy/                   Active reverse proxy image/config
nginx/                   Alternate proxy config
postgres/                Local persistent data placeholder
rustfs/                  RustFS wrapper image and data placeholder
docker-compose.prod.yml  Production Docker Compose stack
compose.yaml             Local Docker stack
scripts/deploy-prod.sh   Production deployment script
```

