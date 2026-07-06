import { fetchMe } from "@/api/auth";
import { isApiRequestCanceled } from "@/api/client";
import {
  bumpAuthSessionEpoch,
  clearAuthStorage,
  commitAuthSessionIfCurrent,
  getAuthSessionEpoch,
  resetSessionAbortScope,
  useAuthStore,
} from "@/store/auth-store";
import { UserRole, type UserSession } from "@/types/api";
import { isAuthRevocationError } from "@/utils/auth-errors";
import { isJwtExpired } from "@/utils/jwt";
import { secureStorage } from "@/utils/secure-storage";
import { AUTH_STORAGE_KEY } from "@/constants/config";

export const AUTH_BOOTSTRAP_TIMEOUT_MS = 12_000;

type PersistedAuthPayload = {
  token: string;
  user: UserSession;
};

let bootstrapPromise: Promise<void> | null = null;
let bootstrapStarted = false;
let foregroundValidationPromise: Promise<void> | null = null;

function authLog(event: string, detail?: Record<string, unknown>): void {
  if (__DEV__) {
    console.info(`[auth:bootstrap] ${event}`, detail ?? "");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidUserSession(user: unknown): user is UserSession {
  if (!isRecord(user)) {
    return false;
  }

  const role = user.role;
  return (
    typeof user.id === "string" &&
    typeof user.username === "string" &&
    typeof role === "string" &&
    Object.values(UserRole).includes(role as UserRole) &&
    typeof user.is_active === "boolean" &&
    typeof user.created_at === "string" &&
    typeof user.next_screen === "string"
  );
}

function isValidAccessToken(token: unknown): token is string {
  return typeof token === "string" && token.trim().length > 0;
}

export function parsePersistedAuthPayload(raw: string | null): PersistedAuthPayload | null {
  if (!raw?.trim()) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }

    const legacy = parsed.state ?? parsed;
    if (!isRecord(legacy)) {
      return null;
    }

    const token = legacy.token ?? null;
    const user = legacy.user ?? null;

    if (!isValidAccessToken(token) || !isValidUserSession(user)) {
      return null;
    }

    return { token, user };
  } catch {
    return null;
  }
}

export async function clearInvalidAuthSession(reason: string): Promise<void> {
  authLog("clear_session", { reason });
  bumpAuthSessionEpoch();
  resetSessionAbortScope();
  useAuthStore.setState({
    token: null,
    user: null,
    sessionChecked: true,
    hydrated: true,
  });
  await clearAuthStorage();
}

function markBootstrapComplete(sessionChecked = true): void {
  useAuthStore.setState({
    hydrated: true,
    sessionChecked,
  });
}

type PersistedReadResult = {
  payload: PersistedAuthPayload | null;
  corrupt: boolean;
};

async function readPersistedAuth(): Promise<PersistedReadResult> {
  try {
    const raw = await secureStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw?.trim()) {
      return { payload: null, corrupt: false };
    }
    const payload = parsePersistedAuthPayload(raw);
    return { payload, corrupt: payload === null };
  } catch {
    return { payload: null, corrupt: true };
  }
}

async function validatePersistedSession(
  epoch: number,
  token: string,
  cachedUser: UserSession,
): Promise<void> {
  if (isJwtExpired(token)) {
    authLog("token_expired_locally");
    await clearInvalidAuthSession("token_expired");
    return;
  }

  try {
    const freshUser = await fetchMe();
    if (!commitAuthSessionIfCurrent(epoch, token, freshUser)) {
      authLog("validation_superseded");
      return;
    }
    authLog("session_validated", { role: freshUser.role });
  } catch (error) {
    if (epoch !== getAuthSessionEpoch()) {
      return;
    }
    if (isApiRequestCanceled(error)) {
      authLog("validation_canceled");
      return;
    }
    if (isAuthRevocationError(error)) {
      await clearInvalidAuthSession("token_revoked");
      return;
    }
    if (isJwtExpired(token)) {
      await clearInvalidAuthSession("token_expired_offline");
      return;
    }
    authLog("validation_offline_fallback", { username: cachedUser.username });
    useAuthStore.setState({ sessionChecked: true, hydrated: true });
  }
}

async function runAuthBootstrap(): Promise<void> {
  const epoch = getAuthSessionEpoch();
  const { payload: persisted, corrupt } = await readPersistedAuth();

  if (!persisted) {
    if (corrupt) {
      await clearInvalidAuthSession("corrupt_or_invalid_payload");
      return;
    }

    const hasLiveSession = Boolean(useAuthStore.getState().token && useAuthStore.getState().user);
    if (hasLiveSession) {
      markBootstrapComplete(true);
      return;
    }

    markBootstrapComplete(true);
    return;
  }

  if (isJwtExpired(persisted.token)) {
    await clearInvalidAuthSession("token_expired_on_restore");
    return;
  }

  const { token, user } = persisted;

  if (epoch !== getAuthSessionEpoch()) {
    markBootstrapComplete(useAuthStore.getState().sessionChecked);
    return;
  }

  bumpAuthSessionEpoch();
  const validationEpoch = getAuthSessionEpoch();
  useAuthStore.setState({
    token,
    user,
    sessionChecked: false,
    hydrated: false,
  });

  await validatePersistedSession(validationEpoch, token, user);
}

function completeBootstrapWithWatchdog(): void {
  const { token, user, sessionChecked } = useAuthStore.getState();
  if (token && user && !sessionChecked) {
    if (isJwtExpired(token)) {
      void clearInvalidAuthSession("watchdog_token_expired");
      return;
    }
    authLog("watchdog_offline_complete", { username: user.username });
    useAuthStore.setState({ sessionChecked: true });
  }
  markBootstrapComplete(true);
}

export function startAuthBootstrap(): void {
  if (bootstrapStarted) {
    return;
  }
  bootstrapStarted = true;
  authLog("start");

  const watchdogId = setTimeout(() => {
    authLog("watchdog_timeout");
    completeBootstrapWithWatchdog();
  }, AUTH_BOOTSTRAP_TIMEOUT_MS);

  bootstrapPromise = runAuthBootstrap()
    .catch((error: unknown) => {
      authLog("bootstrap_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      void clearInvalidAuthSession("bootstrap_error");
    })
    .finally(() => {
      clearTimeout(watchdogId);
      if (!useAuthStore.getState().hydrated) {
        completeBootstrapWithWatchdog();
      }
      authLog("complete", {
        hasToken: Boolean(useAuthStore.getState().token),
        role: useAuthStore.getState().user?.role ?? null,
        sessionChecked: useAuthStore.getState().sessionChecked,
      });
    });
}

export function waitForAuthBootstrap(): Promise<void> {
  startAuthBootstrap();
  return bootstrapPromise ?? Promise.resolve();
}

export async function revalidateSessionOnForeground(): Promise<void> {
  const { token, user, sessionChecked } = useAuthStore.getState();
  if (!token || !user || !sessionChecked) {
    return;
  }
  if (isJwtExpired(token)) {
    await clearInvalidAuthSession("foreground_token_expired");
    return;
  }
  if (foregroundValidationPromise) {
    return foregroundValidationPromise;
  }

  const epoch = getAuthSessionEpoch();
  foregroundValidationPromise = (async () => {
    try {
      const freshUser = await fetchMe();
      commitAuthSessionIfCurrent(epoch, token, freshUser);
    } catch (error) {
      if (isAuthRevocationError(error)) {
        await clearInvalidAuthSession("foreground_token_revoked");
      }
    }
  })().finally(() => {
    foregroundValidationPromise = null;
  });

  return foregroundValidationPromise;
}

// ponytail: run with AUTH_BOOTSTRAP_SELF_CHECK=1 npx tsx frontend/src/auth/bootstrap-auth.ts
export function runAuthBootstrapSelfCheck(): void {
  if (parsePersistedAuthPayload(null) !== null) {
    throw new Error("null payload should parse as null");
  }
  if (
    parsePersistedAuthPayload(
      JSON.stringify({ state: { token: "abc", user: { id: "1", username: "x", role: "nope" } } }),
    ) !== null
  ) {
    throw new Error("invalid role should be rejected");
  }
  const valid = parsePersistedAuthPayload(
    JSON.stringify({
      state: {
        token: "token",
        user: {
          id: "1",
          username: "shop",
          role: UserRole.SHOP_ACCOUNT,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
          next_screen: "billing",
        },
      },
    }),
  );
  if (!valid?.token || !valid.user || valid.user.role !== UserRole.SHOP_ACCOUNT) {
    throw new Error("valid payload should parse");
  }
}

if (process.env.AUTH_BOOTSTRAP_SELF_CHECK === "1") {
  runAuthBootstrapSelfCheck();
}
