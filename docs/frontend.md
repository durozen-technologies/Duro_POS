# Frontend

The frontend is an Expo React Native application in `frontend/`. It serves both admin users and shop counter users.

## Responsibilities

- Login and secure auth hydration
- Admin dashboard, shops, items, categories, pricing, inventory, bills, and receipt preview
- Shop billing flow with Tamil-aware item names
- Cart state and exact-payment checkout UI
- Receipt printing on Android through Bluetooth or USB ESC/POS printers
- Fallback printing with `expo-print` on unsupported platforms
- API base URL probing and failover

## Stack

- Expo 54
- React Native and TypeScript
- React Navigation
- Zustand
- React Hook Form and Zod
- NativeWind
- Axios
- `@haroldtran/react-native-thermal-printer`
- `expo-print`
- `expo-secure-store`

## Key Files

```text
frontend/src/api/client.ts                         API base URL probing and auth handling
frontend/src/api/admin.ts                          Admin API calls
frontend/src/api/billing.ts                        Checkout preview and commit calls
frontend/src/api/inventory.ts                      Shop inventory API calls
frontend/src/navigation/app-navigator.tsx          Role-based navigation
frontend/src/store/auth-store.ts                   Auth state
frontend/src/store/cart-store.ts                   Cart state
frontend/src/store/printer-store.ts                Printer selection
frontend/src/screens/shop/billing-screen.tsx       Shop billing cart
frontend/src/screens/shop/checkout-screen.tsx      Print-before-commit checkout
frontend/src/screens/shop/inventory-management-screen.tsx  Shop inventory use/add flow
frontend/src/screens/admin/admin-dashboard-screen.tsx      Admin dashboard
frontend/src/screens/admin/admin-item-editor-screen.tsx    Item editor
frontend/src/types/api.ts                          API DTO and enum types
```

## Local Setup

```bash
cd frontend
nub install
cp .env.example .env
nub run start
```

Set the backend URL in `frontend/.env`:

```env
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

For an Android emulator, the app can use `10.0.2.2` as a host-machine fallback. For a physical Android device, use a LAN IP or run:

```bash
adb reverse tcp:8000 tcp:8000
```

## Printer Flow

Android is the main supported printing target.

- Bluetooth and USB thermal printing use `@haroldtran/react-native-thermal-printer`.
- Saved printer configuration is stored in the printer store.
- Checkout must print before commit.
- If printing fails, the backend commit should not happen.

The shop checkout screen prepares a preview, prints it, and commits only after the print job succeeds.

## Type Safety

API-facing enums live in `frontend/src/types/api.ts`. Prefer enum members such as `BaseUnit.KG`, `BaseUnit.UNIT`, `UnitType.WEIGHT`, and `InventoryMovementType.ADD` over raw strings in business logic.

## Validation

```bash
cd frontend
nub run typecheck
```
