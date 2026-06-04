# WhatsApp Bot

The WhatsApp bot is a FastAPI app in `WhatsApp Bot/`. It provides WhatsApp-based sales reporting and branch selection flows.

## Responsibilities

- Receive WhatsApp webhook requests
- Track conversation state
- Authenticate or identify WhatsApp users
- List active branches
- Generate sales summaries from backend bill data
- Reuse backend models and schemas

## Shared Domain Contract

The bot must not duplicate shared database models or shared schemas.

Use:

```text
backend.app.models
backend.app.schemas
```

Compatibility shims:

```text
WhatsApp Bot/app/models.py
WhatsApp Bot/app/schemas.py
```

These files re-export backend definitions so older bot imports keep working.

## Key Files

```text
WhatsApp Bot/main.py
WhatsApp Bot/app/main.py
WhatsApp Bot/app/routers/
WhatsApp Bot/app/services/bot.py
WhatsApp Bot/app/services/sales.py
WhatsApp Bot/app/db.py
WhatsApp Bot/app/config.py
backend/app/models/whatsapp.py
backend/app/schemas/whatsapp.py
```

## Local Setup

```bash
cd "WhatsApp Bot"
cp .env.example .env
uv sync
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

Run from a location where repo-root imports resolve, because the bot imports `backend.app.*`.

## Sales Reporting

Sales summaries query backend tables:

- `Bill`
- `BillItem`
- `Item`
- `Shop`

The summary window is timezone-aware and groups by date range.

## Operational Notes

- Keep WhatsApp-specific database entities in `backend/app/models/whatsapp.py`.
- Keep WhatsApp-specific schemas in `backend/app/schemas/whatsapp.py`.
- Add shared changes to the backend package first.
- The bot has its own FastAPI routers and services, but not its own domain model copy.

