import { apiClient } from "@/api/client";
import { LoginRequest, LoginResponse, RegisterRequest, UserSession } from "@/types/api";

import { AUTH_REVOCATION_CODES } from "@/constants/auth-codes";

const DISABLED_LOGIN_MESSAGES: Record<string, string> = {
  ACCOUNT_DISABLED_BY_SUPER_ADMIN:
    "Your account has been disabled by the super admin. Please contact Durozen Technologies.",
  ORGANIZATION_DISABLED_BY_SUPER_ADMIN:
    "Your organization has been disabled by the super admin. Please contact Durozen Technologies.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type AuthRequestError = Error & { status: number };

function authRequestError(message: string, status: number): AuthRequestError {
  const error = new Error(message) as AuthRequestError;
  error.status = status;
  return error;
}

function getAuthErrorMessage(data: unknown) {
  if (!isRecord(data)) {
    return "";
  }

  if (typeof data.detail === "string") {
    return data.detail;
  }
  if (typeof data.message === "string") {
    return data.message;
  }
  if (isRecord(data.error)) {
    const nestedMessage = data.error.message;
    if (typeof nestedMessage === "string" && nestedMessage.trim()) {
      return nestedMessage;
    }
    const code = data.error.code;
    if (typeof code === "string" && code in DISABLED_LOGIN_MESSAGES) {
      return DISABLED_LOGIN_MESSAGES[code];
    }
  }
  if (typeof data.error === "string") {
    return data.error;
  }

  return "";
}

export async function login(payload: LoginRequest) {
  const { data, status } = await apiClient.post<LoginResponse | unknown>(
    "/api/v1/auth/login",
    payload,
    {
      validateStatus: (responseStatus) =>
        (responseStatus >= 200 && responseStatus < 300) ||
        responseStatus === 401 ||
        responseStatus === 403 ||
        responseStatus === 429,
    },
  );

  if (status === 401) {
    throw authRequestError(
      getAuthErrorMessage(data) || "Invalid username or password",
      401,
    );
  }
  if (status === 403) {
    throw authRequestError(
      getAuthErrorMessage(data) ||
        "You do not have access to sign in. Please contact Durozen Technologies.",
      403,
    );
  }
  if (status === 429) {
    throw authRequestError(
      getAuthErrorMessage(data) ||
        "Too many login attempts. Please wait a moment before retrying.",
      429,
    );
  }

  return data as LoginResponse;
}

export async function registerAdmin(payload: RegisterRequest) {
  const { data } = await apiClient.post<LoginResponse>("/api/v1/auth/register", payload);
  return data;
}

export async function fetchMe(signal?: AbortSignal) {
  const { data } = await apiClient.get<UserSession>("/api/v1/auth/me", { signal });
  return data;
}
