# Billing System

Mobile-first meat billing system with:

- a FastAPI backend for authentication, shop management, daily pricing, billing, receipts, and audit logs
- an Expo React Native frontend for admin and shop operators
- Android Bluetooth and USB ESC/POS receipt printing for shop counters

The project is split into two app folders:

- `backend/` for the API and database layer
- `frontend/` for the mobile and web client

## Product Flow

1. Create the first admin account from the login screen or `POST /api/v1/auth/register`.
2. Admin creates shop accounts from the dashboard.
3. Shop users log in with generated usernames like `ml1`, `ml2`, `ml3`.
4. Each shop sets the full daily price sheet before billing starts.
5. Counter staff add items to the cart and move to checkout.
6. The backend accepts a bill only when cash plus UPI exactly matches the total.
7. The receipt screen can print directly to a saved Bluetooth or USB thermal printer on Android, or fall back to system print on web and iOS.
8. A settled receipt and audit log entry are created immediately after checkout.

## Tech Stack

- Backend: FastAPI, SQLAlchemy async, PostgreSQL, JWT auth, `uv`
- Frontend: Expo 54, React Native, TypeScript, React Navigation, Zustand, React Hook Form, NativeWind, `@haroldtran/react-native-thermal-printer`

## Repository Layout

```text
.
├── backend/
│   ├── app/
│   ├── .env.example
│   ├── main.py
│   ├── pyproject.toml
│   └── README.md
├── frontend/
│   ├── src/
│   ├── App.tsx
│   ├── package.json
│   └── README.md
└── README.md
```

## Prerequisites

- Python `3.12+`
- `uv`
- PostgreSQL
- Node.js `18+`
- npm
- Android emulator, iOS simulator, or web browser for the frontend
- Android development build for Bluetooth and USB receipt printing

## Quick Start

### 1. Start the Backend

```bash
cd backend
cp .env.example .env
uv sync
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The backend creates tables on startup and seeds the default billing items automatically.

For backend linting and formatting:

```bash
cd backend
uv sync --group dev
uv run ruff check .
uv run ruff format .
```

For a quick backend unused-code check:

```bash
cd backend
uv run ruff check app --select F401,F841
```

### 2. Start the Frontend

```bash
cd frontend
npm install
npx expo start
```

For the full POS printer workflow on Android, build a native development app once and then use the dev client:

```bash
cd frontend
npx expo run:android
npm run start:dev
```

If you need a custom backend host, set `EXPO_PUBLIC_API_BASE_URL` before starting Expo:

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:8000 npx expo start --lan
```

## Default Access Rules

- First admin registration is allowed only once.
- New shop accounts get usernames in `ml<number>` format.
- Default shop password comes from the backend setting `shop_default_password` and currently defaults to `ml123`.
- Disabled shops cannot log in or create bills.

## Networking Notes

- Backend bind address `0.0.0.0` is not a usable frontend URL by itself.
- Android emulator usually needs `http://10.0.2.2:8000`.
- iOS simulator and local web usually use `http://127.0.0.1:8000`.
- On a phone, point the frontend to your computer's LAN IP or a public backend tunnel.
- Expo tunnel mode shares the JavaScript bundle, not the backend API.

## Direct POS Printing

- Bluetooth and USB ESC/POS printing are wired into the frontend shop flow with the `@haroldtran/react-native-thermal-printer` package.
- Expo Go cannot load this native printer module. Use an Android development build or release build for the printer workflow.
- The app now includes a `Printer Setup` screen for loading Bluetooth and USB printers, connecting one, saving it, and test-printing a receipt.
- Once a printer is saved on the device, completed receipts can print directly from the receipt screen.
- Web and iOS keep the existing `expo-print` system-print fallback.

## Testing

### Backend Tests

Run tests from the backend directory:

```bash
cd backend
uv sync
uv run --with pytest pytest ../test/ -v
```

Run specific test categories:

```bash
# Unit tests only
uv run --with pytest pytest ../test/unit/ -v

# Integration tests only
uv run --with pytest pytest ../test/integration/ -v
```

Run with coverage:

```bash
uv run --with pytest --with pytest-cov pytest ../test/ --cov=app --cov-report=html
```

Notes:

- The test directory lives at the repository root, so the path must be `../test/` when running from `backend/`.
- `pytest` is not currently listed as a backend dependency, so `uv run --with pytest ...` avoids the missing module error.
- Coverage flags require `pytest-cov`, so include `--with pytest-cov` when you want an HTML report.

## Helpful URLs

- API docs: `http://127.0.0.1:8000/docs`
- ReDoc: `http://127.0.0.1:8000/redoc`
- Health check: `http://127.0.0.1:8000/api/v1/health`

## Documentation By App

- Backend setup and API notes: [backend/README.md](backend/README.md)
- Frontend setup and operator flow: [frontend/README.md](frontend/README.md)
