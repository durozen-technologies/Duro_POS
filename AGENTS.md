# Billing System Agent Guide

## Scope

This file applies to the whole repository. It provides high-level architectural constraints and business rules for the Billing System.

## Project Shape

- `backend/`: FastAPI, SQLAlchemy (async), PostgreSQL, Alembic, RustFS for item images.
- `frontend/`: Expo React Native, TypeScript, Zustand, NativeWind, Android ESC/POS printing.
- `WhatsApp Bot/`: FastAPI bot reusing `backend.app` models and schemas for sales reporting.
- `caddy/`: Reverse proxy with automatic HTTPS and rate limiting.

## Non-Negotiable Business Rules

- **Checkout Flow**: Receipt data must only be committed to the database *after* successful printing. The flow is: `preview` -> `print` -> `commit`.
- **Image Storage**: Item images must be stored in RustFS (S3-compatible). Use `image_object_key` and `image_content_type`. Never reintroduce `image_data` bytes into Postgres.
- **Tamil Support**: `tamil_name` is a first-class requirement for items. Admin updates must require valid Tamil names. Frontend should toggle display based on language selection.
- **Exact Payment**: Checkout requires the sum of Cash and UPI amounts to exactly match the bill total.

## Backend Architecture

- **Shared Domain**: `backend.app.models` and `backend.app.schemas` are the source of truth for both the API and the WhatsApp Bot.
- **Migrations**: Always use Alembic revisions in `backend/migrations/versions/`. Use [migrate.py](file:///home/sachinn-p/Codes/Billing System/backend/migrate.py) for deployments.
- **Startup**: Idempotent startup tasks in [startup.py](file:///home/sachinn-p/Codes/Billing System/backend/app/db/startup.py) handle legacy data migration and bucket initialization.

## Frontend Architecture

- **State Management**: Zustand for cart, auth, and printer configuration.
- **Printing**: Uses `@haroldtran/react-native-thermal-printer` on Android. Fallback to `expo-print` on other platforms.
- **API Client**: [client.ts](file:///home/sachinn-p/Codes/Billing System/frontend/src/api/client.ts) handles base URL probing and failover.

## Validation Commands

```bash
# Backend Lint & Test
cd backend && uv run ruff check . && uv run --with pytest pytest ../test/

# Frontend Typecheck
cd frontend && npm run typecheck
```
