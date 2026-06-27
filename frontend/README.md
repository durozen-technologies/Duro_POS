# Meat Billing POS Frontend

Expo React Native client for the Billing System. The current app supports:

- shared login flow for admin and shop users
- persisted auth session hydration on app launch
- admin dashboard for shops, analytics, bills, and receipt preview/printing
- shop bootstrap flow with required daily price setup before billing
- billing cart, split payment checkout, and direct receipt printing
- Android Bluetooth and USB ESC/POS printer setup with saved device selection
- Tamil-aware shop UI translations for the billing flow

## Stack

- Expo 54
- React Native 0.81 with TypeScript
- React Navigation
- Zustand
- React Hook Form
- NativeWind
- Axios
- `@haroldtran/react-native-thermal-printer`
- `expo-print`
- `expo-secure-store`

## Project Layout

```text
frontend/
├── src/
│   ├── api/
│   ├── components/
│   ├── constants/
│   ├── hooks/
│   ├── locales/
│   ├── navigation/
│   ├── screens/
│   ├── services/
│   ├── store/
│   ├── types/
│   └── utils/
├── scripts/
├── App.tsx
├── app.config.js
├── eas.json
├── global.css
├── package.json
└── README.md
```

## Prerequisites

- Node.js `18+`
- `nub`
- reachable backend API URL
- Android emulator, Android device, iOS simulator, or browser
- Android dev build for native Bluetooth and USB printer support

## Install

```bash
cd frontend
nub install
```

## Environment

Create a local env file:

```bash
cp .env.example .env
```

Set the backend URL:

```env
EXPO_PUBLIC_API_BASE_URL=https://your-api.example.com
```

The Expo app config also reads `EXPO_PUBLIC_API_BASE_URL` from:

- shell environment
- local `frontend/.env`
- Expo config `extra.expoPublicApiBaseUrl`

Relevant files:

- [app.config.js](app.config.js)
- [src/constants/config.ts](src/constants/config.ts)
- [src/api/client.ts](src/api/client.ts)

## API Base URL Logic

The frontend does more than a simple fixed base URL:

- it reads `EXPO_PUBLIC_API_BASE_URL`
- on Android, it can generate fallback candidates such as `10.0.2.2`
- it stores the last reachable API base URL in secure storage
- it probes `/api/v1/health` and can fail over to another candidate
- it shows different error messages for tunnel misuse, CORS failures, and network failures

Important behavior:

- Expo tunnel is not treated as a backend host
- Expo tunnel shares the JS bundle only, not your backend
- if the backend URL is missing, requests are blocked with a configuration error

## Run

### Expo Go

```bash
cd frontend
nub run start
```

Or:

```bash
cd frontend
nub run start:go
```

Use Expo Go for UI testing without native printer access.

### Android Development Build

```bash
cd frontend
nub run doctor:android
nub run android:dev
nub run start:dev -- --clear
```

This is the main path for real printer testing.

### Android Emulator

```bash
cd frontend
nub run android:emu
```

Or start Metro separately:

```bash
cd frontend
nub run start:android
```

### Physical Android Device Over USB

```bash
adb devices
cd frontend
nub run android:usb
nub run start:dev -- --clear
```

If the backend runs on the same computer:

```bash
adb reverse tcp:8000 tcp:8000
```

### iOS

```bash
cd frontend
nub run ios
```

### Web

```bash
cd frontend
nub run web
```

### Physical Device On The Same Wi-Fi

```bash
cd frontend
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:8000 nub exec expo start --lan
```

Replace `192.168.1.20` with your machine’s LAN IP.

### Expo Tunnel

If you use Expo tunnel, point the app at a public backend URL:

```bash
cd frontend
EXPO_PUBLIC_API_BASE_URL=https://your-public-backend.example.com nub exec expo start --tunnel
```

## Scripts

Current scripts from [package.json](package.json):

```bash
nub run start
nub run start:go
nub run start:dev
nub run start:android
nub run doctor:android
nub run emulator:start
nub run android
nub run android:emu
nub run android:usb
nub run android:dev
nub run ios
nub run web
nub run lint
nub run typecheck
nub run eas:configure
nub run eas:android:preview
nub run eas:android:production
nub run eas:android:run
```

The project also runs a bundled native dependency cleanup script automatically before several commands.

## App Flow

### Auth

- the visible auth UI is currently login-only
- session state is stored with secure storage and restored on launch
- login resets cart and cached prices before storing the new session

Relevant files:

- [src/screens/auth/login-screen.tsx](src/screens/auth/login-screen.tsx)
- [src/store/auth-store.ts](src/store/auth-store.ts)
- [src/hooks/use-auth-hydration.ts](src/hooks/use-auth-hydration.ts)

### Admin Experience

The admin flow currently includes:

- shop creation, update, enable/disable, and delete
- dashboard bootstrap loading
- sales, payment, and item analytics
- bill detail and receipt preview
- saved printer-based receipt printing
- global and per-shop daily price management

Main screen:

- [src/screens/admin/admin-dashboard-screen.tsx](src/screens/admin/admin-dashboard-screen.tsx)

### Shop Experience

The shop flow currently includes:

- shop bootstrap fetch after login
- today's price setup
- translated item labels for billing
- quantity entry by `kg` or `unit`
- cart review and removal
- saved printer summary inside billing and checkout
- exact-match split payment checkout
- direct image-based receipt printing through the saved printer

Main screens:

- [src/screens/shop/billing-screen.tsx](src/screens/shop/billing-screen.tsx)
- [src/screens/shop/checkout-screen.tsx](src/screens/shop/checkout-screen.tsx)
- [src/screens/shop/printer-setup-screen.tsx](src/screens/shop/printer-setup-screen.tsx)

## Printer Support

The app supports:

- Bluetooth printers
- USB printers
- saved preferred printer per device
- test-print flow
- image-based receipt printing after checkout

Printer support notes:

- Expo Go cannot use the native printer module
- Android native builds can discover and connect Bluetooth/USB printers
- web and iOS keep fallback print behavior through `expo-print`

Relevant files:

- [src/services/printer-service.ts](src/services/printer-service.ts)
- [src/store/printer-store.ts](src/store/printer-store.ts)
- [src/hooks/use-receipt-image-print-job.tsx](src/hooks/use-receipt-image-print-job.tsx)
- [src/api/receipts.ts](src/api/receipts.ts)

## Translations

The shop flow includes translation support, including Tamil-aware UI treatment.

Relevant files:

- [src/hooks/use-shop-translation.ts](src/hooks/use-shop-translation.ts)
- [src/locales/shop-translations.json](src/locales/shop-translations.json)

## EAS Build

This project includes [eas.json](eas.json) with:

- `development` - internal development client build
- `preview` - internal Android APK build
- `production` - Android AAB build

One-time setup:

```bash
cd frontend
nub run eas:configure
```

Preview build:

```bash
cd frontend
nub run eas:android:preview
```

Production build:

```bash
cd frontend
nub run eas:android:production
```

Install latest built Android artifact:

```bash
cd frontend
nub run eas:android:run
```

Cloud builds should use EAS environment variables for `EXPO_PUBLIC_API_BASE_URL`.

## Lint And Typecheck

```bash
cd frontend
nub run lint
nub run typecheck
```

## Notes

- the navigation stack switches between auth, admin, and shop flows from stored session state
- shop pricing must be completed before billing is available
- checkout requires an exact payment match before printing can proceed
- the app keeps a saved API host and can reuse it across launches
- admin receipt printing uses the same saved printer infrastructure as the shop flow
