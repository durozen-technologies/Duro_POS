# Billing System Agent Guide

## Overview

This file provides the authoritative reference for working with the Billing System repository. It documents high-level architectural constraints, business rules, codebase organization, and development workflows that all developers must follow.

## Scope

This guide applies to the entire repository and supersedes component-level documentation for architectural decisions and integration patterns.

---

## Project Shape

The system consists of four main components:

- **`backend/`**: FastAPI REST API with SQLAlchemy async ORM, PostgreSQL database, Alembic migrations, and RustFS for item image storage.
- **`frontend/`**: Expo React Native mobile application (TypeScript) with Zustand state management, NativeWind styling, and Android ESC/POS thermal printer support.
- **`WhatsApp Bot/`**: FastAPI bot service that reuses `backend.app.models` and `backend.app.schemas` for sales reporting and order management.
- **`caddy/`**: Reverse proxy with automatic HTTPS, rate limiting, and request/response filtering.

---

## Non-Negotiable Business Rules

These rules are fundamental to system correctness and must not be violated:

### Checkout Flow
Receipt data must **only be committed to the database after successful printing**. The mandatory sequence is:
1. `preview` - Display receipt for user confirmation
2. `print` - Execute printing (thermal or fallback)
3. `commit` - Persist receipt data to database

### Image Storage
- Item images are stored in **RustFS (S3-compatible storage)**, not in Postgres.
- Use `image_object_key` and `image_content_type` fields; never reintroduce `image_data` bytes into the database.
- Frontend must load images via the S3 URL from the object key.

### Tamil Language Support
- `tamil_name` is a **first-class requirement** for all items.
- Admin panel must validate that every item has a valid Tamil name when created or updated.
- Frontend toggles display between English and Tamil names based on user language preference.

### Payment Accuracy
- Checkout requires **exact payment matching**: `cash_amount + upi_amount = bill_total`
- No rounding, discounts, or partial payments without explicit business rule changes.
- Treat money as exact values; avoid floating-point arithmetic for receipt totals, payment validation, and persistence.

### Receipt, Inventory, and Audit Integrity
- Receipt commit, stock updates, and audit logging must happen in one backend transaction after print success.
- Failed printing must leave no committed receipt and no stock mutation; support retry without duplicate receipt creation.
- Stock must never become negative unless an explicit business rule and test coverage are added.
- Audit logs are required for login-sensitive/admin actions, item create/update/delete, stock changes, receipt commits, and payment-impacting operations.

---

## Backend Architecture

### Shared Domain Model
The foundation of backend design is a **single source of truth**:
- `backend.app.models`: SQLAlchemy ORM models for all entities (Items, Receipts, Users, Audit Logs, etc.)
- `backend.app.schemas`: Pydantic schemas for request/response validation
- Both `backend.app` and `WhatsApp Bot/app` import and reuse these modules directly

### Database Migrations
- **Always use Alembic**: All schema changes go through `backend/migrations/versions/`
- **Deployment script**: Use [migrate.py](file:///home/sachinn-p/Codes/Durozen%20Projects/Billing%20System/backend/migrate.py) to apply migrations in production
- **Idempotent startup**: [startup.py](file:///home/sachinn-p/Codes/Durozen%20Projects/Billing%20System/backend/app/db/startup.py) handles legacy data migration and RustFS bucket initialization on every application start

### API Layers
- **Routers** (`app/routers/`): Endpoint definitions and request routing (auth, shop, admin, health, audit_log)
- **Services** (`app/services/`): Business logic and core operations
- **Core** (`app/core/`): Shared utilities, configuration, exception handling, and dependency injection

### Security & Configuration
- Never commit secrets, credentials, tokens, certificates, database dumps, or production `.env` values.
- Keep environment-variable examples documented, but use placeholders for sensitive values.
- Route authorization must stay role-aware; admin-only actions must not become reachable by cashier/shop users.

---

## Frontend Architecture

### State Management
- **Zustand stores** for cart, authentication, printer configuration, and UI state
- Stores are the single source of truth for client-side data
- API responses update stores; never duplicate data between store and component state

### Printing Strategy
- **Android**: `@haroldtran/react-native-thermal-printer` for ESC/POS thermal printers
- **Other platforms**: Fallback to `expo-print` (PDF-based printing)
- Receipt printing must complete successfully before checkout is marked as complete

### API Client & Network Resilience
- [client.ts](file:///home/sachinn-p/Codes/Durozen%20Projects/Billing%20System/frontend/src/api/client.ts) implements base URL probing and automatic failover
- Handles offline scenarios and network transitions gracefully
- All API requests go through this single client

### Frontend Checkout Safety
- The UI must keep checkout in preview/print/commit order, including offline, printer error, and retry states.
- After checkout success or logout, clear only the relevant stores and avoid stale cart/payment/printer state.
- Admin item forms must validate English name, Tamil name, price, stock, image metadata, and required category fields before submit.

---

## Codebase Structure

### Backend (`backend/`)
- **`main.py`**: Application entry point; delegates to `app/main.py`
- **`migrate.py`**: Database migration runner using Alembic
- **`app/main.py`**: FastAPI app initialization, middleware setup, router registration
- **`app/models/`**: SQLAlchemy ORM models (Items, Receipts, Users, AuditLogs, etc.)
- **`app/schemas/`**: Pydantic request/response schemas for all endpoints
- **`app/routers/`**: Route handlers for auth, shop, admin, health checks, and audit logs
- **`app/services/`**: Business logic layer (authentication, item management, receipt processing)
- **`app/db/`**: Database configuration, session management, and startup tasks
- **`app/core/`**: Core utilities (config, dependencies, custom exceptions, constants)
- **`app/auth/`**: JWT handling, password hashing, and authentication decorators
- **`migrations/`**: Alembic version control for database schema
- **`pyproject.toml`**: Python dependencies and project configuration
- **`alembic.ini`**: Alembic configuration file
- **`Dockerfile`**: Container image definition for backend service

### Frontend (`frontend/`)
- **`App.tsx`**: Root component and app shell
- **`app.config.js`**: Expo configuration (plugins, permissions, build settings)
- **`package.json`**: Node.js dependencies and scripts
- **`tsconfig.json`**: TypeScript compiler options
- **`src/api/`**: Centralized API client with failover and base URL detection
- **`src/store/`**: Zustand stores for global state (cart, auth, printer, UI)
- **`src/screens/`**: Screen components (Checkout, Inventory, Admin, Dashboard, etc.)
- **`src/components/`**: Reusable UI components (buttons, modals, forms, cards)
- **`android/`**: Android-specific configuration, gradle settings, and manifest
- **`printer/`**: Thermal printer integration utilities
- **`assets/`**: Images, fonts, and static resources
- **`global.css`**: Global styling with NativeWind
- **`metro.config.js`**: React Native bundler configuration

### WhatsApp Bot (`WhatsApp Bot/`)
- **`main.py`**: FastAPI bot service entry point
- **`app/models/`**: Imports from `backend.app.models` (no duplication)
- **`app/schemas/`**: Imports from `backend.app.schemas` (no duplication)
- **`pyproject.toml`**: Bot-specific dependencies

### Infrastructure
- **`compose.yaml`**: Docker Compose configuration for local development (postgres, backend, frontend, caddy, rustfs)
- **`caddy/`**: Reverse proxy configuration with automatic HTTPS and rate limiting
  - `Caddyfile`: Main routing configuration
  - `Dockerfile`: Caddy container image
- **`postgres/`**: PostgreSQL database setup and persistence
- **`rustfs/`**: S3-compatible object storage for images
- **`nginx/`**: Alternative reverse proxy (legacy; Caddy preferred)
- **`docker-compose.prod.yml`**: Production compose overrides
- **`scripts/`**: Deployment and utility scripts (deploy-prod.sh, postgres-recover.sh, etc.)

### Testing
- **`test/unit/`**: Unit tests for individual functions and utilities
- **`test/integration/`**: Integration tests for API endpoints and workflows
- **`test/support.py`**: Test fixtures, factories, and helper functions

### Documentation & Configuration
- **`docs/`**: Comprehensive documentation by component (backend.md, frontend.md, caddy.md, rustfs.md, etc.)
- **`pyrightconfig.json`**: Python type checking configuration for Pylance
- **`migrations.md`**: Database migration procedures and guidelines
- **`AGENTS.md`**: This file; authoritative architectural guide

---

## Key Development Workflows

### Backend Development
1. Make schema changes via Alembic: `cd backend && uv run alembic revision --autogenerate -m "description"`
2. Update ORM models in `app/models/`
3. Create or update Pydantic schemas in `app/schemas/`
4. Implement business logic in `app/services/`
5. Add routes in `app/routers/`
6. Validate with: `cd backend && uv run ruff check . && uv run --with pytest pytest ../test/`

### Frontend Development
1. Update Zustand stores in `src/store/` for state changes
2. Create or modify screens in `src/screens/`
3. Add reusable components to `src/components/`
4. Update API client (`src/api/client.ts`) if endpoint signatures change
5. Validate with: `nub run typecheck`

### Database Migrations
- **Creating**: `cd backend && uv run alembic revision --autogenerate -m "meaningful name"`
- **Reviewing**: Check generated file in `backend/migrations/versions/` before deploying
- **Applying**: `cd backend && python migrate.py` (handled automatically on startup)

### Deployment
- Backend: `docker-compose -f docker-compose.prod.yml up -d backend`
- Frontend: Use EAS Build or manual APK generation
- Infrastructure: Update `docker-compose.prod.yml` and redeploy services

---

## Validation Commands

### Backend Lint & Test
```bash
cd backend && uv run ruff check . && uv run --with pytest pytest ../test/
```

### Frontend Typecheck
```bash
cd frontend && nub run typecheck
```

### Docker Build & Run (Local Development)
```bash
docker-compose up -d
```

---

## Important File References

- **Migrations**: [migrate.py](file:///home/sachinn-p/Codes/Durozen%20Projects/Billing%20System/backend/migrate.py)
- **Startup Tasks**: [startup.py](file:///home/sachinn-p/Codes/Durozen%20Projects/Billing%20System/backend/app/db/startup.py)
- **API Client**: [client.ts](file:///home/sachinn-p/Codes/Durozen%20Projects/Billing%20System/frontend/src/api/client.ts)
- **Docker Compose**: [compose.yaml](file:///home/sachinn-p/Codes/Durozen%20Projects/Billing%20System/compose.yaml)

---

## Conventions & Best Practices

- **Single Responsibility**: Each service, router, and component should have one clear purpose
- **No Magic Strings**: Use constants defined in `app/core/` or store configuration
- **Async First**: Backend uses async SQLAlchemy; always await database operations
- **Type Safety**: Frontend uses strict TypeScript; backend uses Pydantic for validation
- **Testing**: Write focused tests alongside features; integration tests verify checkout, payment, inventory, auth, migrations, and API workflows when touched
- **Documentation**: Update this guide when adding new architectural patterns or business rules
- **Dependencies**: Use the package manager already used by that component and commit lockfile changes (`uv.lock`, `lock.yaml`, etc.) when dependencies change
- **Project Hygiene**: Always review and update `README.md`, `.gitignore`, relevant Dockerfiles, Compose files, and app/build config when changes affect setup, dependencies, generated files, build behavior, runtime configuration, or deployment
