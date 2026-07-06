import { isAxiosError } from "axios";

import { AUTH_REVOCATION_CODES } from "@/constants/auth-codes";

function isApiRequestCanceled(error: unknown) {
  return isAxiosError(error) && (error.code === "ERR_CANCELED" || error.name === "CanceledError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getApiErrorCode(error: unknown): string | undefined {
  if (!isAxiosError(error) || !error.response) {
    return undefined;
  }
  const data = error.response.data;
  if (!isRecord(data)) {
    return undefined;
  }
  if (isRecord(data.error) && typeof data.error.code === "string") {
    return data.error.code;
  }
  if (typeof data.code === "string") {
    return data.code;
  }
  return undefined;
}

export function isAuthRevocationError(error: unknown): boolean {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === 401) {
    return true;
  }
  if (status !== 403) {
    return false;
  }
  const code = getApiErrorCode(error);
  return code !== undefined && AUTH_REVOCATION_CODES.has(code);
}

export function isAuthSessionError(error: unknown): boolean {
  if (isApiRequestCanceled(error)) {
    return true;
  }
  const { hasAuthToken } = require("@/store/auth-store") as typeof import("@/store/auth-store");
  if (!hasAuthToken()) {
    return true;
  }
  return isAuthRevocationError(error);
}

// ponytail: run with AUTH_UTILS_SELF_CHECK=1 npx tsx frontend/src/utils/auth-errors.ts
export function runAuthErrorsSelfCheck(): void {
  const revoked = {
    isAxiosError: true,
    response: { status: 403, data: { error: { code: "USER_INACTIVE" } } },
  };
  if (!isAuthRevocationError(revoked)) {
    throw new Error("USER_INACTIVE should revoke session");
  }
  const forbidden = {
    isAxiosError: true,
    response: { status: 403, data: { error: { code: "FORBIDDEN" } } },
  };
  if (isAuthRevocationError(forbidden)) {
    throw new Error("generic FORBIDDEN should not revoke session");
  }
}

if (process.env.AUTH_UTILS_SELF_CHECK === "1") {
  runAuthErrorsSelfCheck();
}
