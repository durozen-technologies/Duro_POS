import { create } from "zustand";
import { Platform } from "react-native";

import { API_BASE_URL, AUTH_STORAGE_KEY, CONFIGURED_API_BASE_URL } from "@/constants/config";
import { useCartStore } from "@/store/cart-store";
import { usePriceStore } from "@/store/price-store";
import { UserSession } from "@/types/api";
import { secureStorage } from "@/utils/secure-storage";

type AuthState = {
  token: string | null;
  user: UserSession | null;
  hydrated: boolean;
  sessionChecked: boolean;
  setSession: (token: string, user: UserSession) => void;
  setHydrated: (value: boolean) => void;
  clearSession: () => void;
};

let sessionAbortController = new AbortController();
let authSessionEpoch = 0;
let logoutInFlight: Promise<void> | null = null;
let persistWriteEpoch = 0;

export function getAuthSessionEpoch(): number {
  return authSessionEpoch;
}

export function bumpAuthSessionEpoch(): number {
  authSessionEpoch += 1;
  return authSessionEpoch;
}

export function getSessionAbortSignal(): AbortSignal {
  return sessionAbortController.signal;
}

export function resetSessionAbortScope(): void {
  sessionAbortController.abort();
  sessionAbortController = new AbortController();
}

export function userHasPermission(
  user: { permissions?: string[] } | null | undefined,
  code: string,
): boolean {
  const permissions = user?.permissions;
  if (!permissions?.length) return false;
  if (permissions.includes("*")) return true;
  return permissions.includes(code);
}

function postLogoutBestEffort(token: string): void {
  const baseUrl = (API_BASE_URL || CONFIGURED_API_BASE_URL || "").replace(/\/$/, "");
  if (!baseUrl) {
    return;
  }
  void fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  }).catch(() => undefined);
}

async function persistAuthSession(token: string, user: UserSession): Promise<void> {
  const writeEpoch = persistWriteEpoch;
  const payload = JSON.stringify({ state: { token, user }, version: 1 });
  await secureStorage.setItem(AUTH_STORAGE_KEY, payload);
  if (writeEpoch !== persistWriteEpoch) {
    await secureStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

export async function clearAuthStorage(): Promise<void> {
  persistWriteEpoch += 1;
  try {
    await secureStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in tests.
  }
}

export const useAuthStore = create<AuthState>()((set) => ({
  token: null,
  user: null,
  hydrated: false,
  sessionChecked: false,
  setSession: (token, user) => {
    bumpAuthSessionEpoch();
    resetSessionAbortScope();
    set({ token, user, sessionChecked: true, hydrated: true });
    void persistAuthSession(token, user).catch(() => undefined);
  },
  setHydrated: (hydrated) => set({ hydrated }),
  clearSession: () => {
    set((state) =>
      state.token === null && state.user === null && state.sessionChecked
        ? state
        : { token: null, user: null, sessionChecked: true },
    );
  },
}));

export function hasAuthToken(): boolean {
  return Boolean(useAuthStore.getState().token);
}

export function isAuthSessionReady(): boolean {
  const { hydrated, token, sessionChecked } = useAuthStore.getState();
  return hydrated && (!token || sessionChecked);
}

export function isAuthSessionCurrent(epoch: number, expectedToken: string | null): boolean {
  return (
    epoch === authSessionEpoch &&
    expectedToken !== null &&
    useAuthStore.getState().token === expectedToken
  );
}

export function commitAuthSessionIfCurrent(
  epoch: number,
  token: string,
  user: UserSession,
): boolean {
  if (!isAuthSessionCurrent(epoch, token)) {
    return false;
  }
  useAuthStore.getState().setSession(token, user);
  return true;
}

export function skipUnlessAuthed(resetLoading?: () => void): boolean {
  if (hasAuthToken()) {
    return false;
  }
  resetLoading?.();
  return true;
}

export function logout(): Promise<void> {
  if (logoutInFlight) {
    return logoutInFlight;
  }

  logoutInFlight = (async () => {
    const token = useAuthStore.getState().token;
    bumpAuthSessionEpoch();
    resetSessionAbortScope();
    useAuthStore.getState().clearSession();
    useCartStore.getState().resetCart();
    usePriceStore.getState().clear();
    await clearAuthStorage();
    if (token) {
      postLogoutBestEffort(token);
    }
  })().finally(() => {
    logoutInFlight = null;
  });

  return logoutInFlight;
}

if (Platform.OS === "web" && typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== AUTH_STORAGE_KEY) {
      return;
    }
    if (!event.newValue) {
      void logout();
    }
  });
}
