import { isAxiosError } from "axios";

export const API_CONNECTION_ERROR_MESSAGE =
  "Unable to connect to the server. Please check your internet connection and try again. Otherwise, contact your administrator.";

export type ApiErrorShape = {
  message: string;
  status?: number;
  requestId?: string;
  baseUrl?: string;
};

const NETWORK_MESSAGE_PATTERN =
  /network request failed|network error|failed to fetch|cannot reach backend|unable to connect|timeout of \d+ms exceeded|econnaborted|err_network|etimedout|econnrefused|enotfound|health probe failed|getaddrinfo|socket hang up|ssl|certificate/i;

const URL_PATTERN = /\bhttps?:\/\/[^\s)\]"']+/gi;
const HOST_PORT_PATTERN = /\b[a-z0-9][a-z0-9.-]*:\d{2,5}\b/i;

const AXIOS_NETWORK_CODES = new Set([
  "ERR_NETWORK",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

export class ApiRequestError extends Error {
  readonly status?: number;
  readonly requestId?: string;
  readonly baseUrl?: string;

  constructor(error: ApiErrorShape, options?: { cause?: unknown }) {
    super(error.message);
    this.name = "ApiRequestError";
    this.status = error.status;
    this.requestId = error.requestId;
    this.baseUrl = error.baseUrl;
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

export function isNetworkConnectionMessage(message: string) {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }
  return trimmed === API_CONNECTION_ERROR_MESSAGE || NETWORK_MESSAGE_PATTERN.test(trimmed);
}

export function isNetworkConnectionError(error: unknown) {
  if (isApiRequestError(error)) {
    return error.message === API_CONNECTION_ERROR_MESSAGE;
  }

  if (isAxiosError(error)) {
    if (!error.response) {
      return true;
    }
    if (error.code && AXIOS_NETWORK_CODES.has(error.code)) {
      return true;
    }
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return isNetworkConnectionMessage(message);
}

export function sanitizeUserFacingMessage(
  message: string,
  fallback = "Something went wrong. Please try again.",
) {
  const trimmed = message.trim();
  if (!trimmed) {
    return fallback;
  }

  if (isNetworkConnectionMessage(trimmed)) {
    return API_CONNECTION_ERROR_MESSAGE;
  }

  const withoutUrls = trimmed.replace(URL_PATTERN, "").replace(/\s{2,}/g, " ").trim();
  if (!withoutUrls) {
    return API_CONNECTION_ERROR_MESSAGE;
  }

  if (HOST_PORT_PATTERN.test(withoutUrls) && /fail|error|refused|timeout|unreachable|probe/i.test(withoutUrls)) {
    return API_CONNECTION_ERROR_MESSAGE;
  }

  if (NETWORK_MESSAGE_PATTERN.test(withoutUrls)) {
    return API_CONNECTION_ERROR_MESSAGE;
  }

  return withoutUrls;
}

export function formatUserFacingApiMessage(
  message: string,
  fallback = "Something went wrong. Please try again.",
) {
  return sanitizeUserFacingMessage(message, fallback);
}

const HTTP_STATUS_MESSAGES: Record<number, string> = {
  400: "Invalid input provided. Please check your data.",
  401: "Session expired. Please sign in again.",
  403: "Access denied. Please contact your administrator.",
  404: "The requested record was not found. It may have been removed. Refresh and try again.",
  409: "This conflicts with existing data. Refresh and try again.",
  413: "The uploaded file is too large. Choose a smaller image.",
  422: "Invalid input provided. Please check your data.",
  429: "Too many requests. Please wait a moment before retrying.",
};

/** User-facing message for an HTTP status without leaking the raw status code. */
export function describeHttpError(
  status: number,
  fallback = "Something went wrong. Please try again.",
) {
  const mapped = HTTP_STATUS_MESSAGES[status];
  if (mapped) {
    return mapped;
  }
  if (status >= 500) {
    return "A server error occurred. Please try again later.";
  }
  return fallback;
}

export function normalizeApiRequestError(error: unknown): ApiRequestError {
  if (isApiRequestError(error)) {
    return error;
  }

  if (error instanceof Error && error.name === "CanceledError") {
    return new ApiRequestError({ message: "Request canceled." }, { cause: error });
  }

  const status = isAxiosError(error) ? error.response?.status : undefined;
  const responseHeaders = isAxiosError(error) ? error.response?.headers : undefined;
  const requestId =
    responseHeaders && typeof responseHeaders === "object"
      ? String(
          (responseHeaders as Record<string, unknown>)["x-request-id"] ??
            (responseHeaders as Record<string, unknown>)["X-Request-ID"] ??
            "",
        )
      : "";
  const baseUrl = isAxiosError(error) ? error.config?.baseURL?.trim() : undefined;

  let message = "Something went wrong. Please try again.";
  if (isNetworkConnectionError(error)) {
    message = API_CONNECTION_ERROR_MESSAGE;
  } else if (error instanceof Error && error.message.trim()) {
    message = sanitizeUserFacingMessage(error.message, message);
  } else if (typeof error === "string" && error.trim()) {
    message = sanitizeUserFacingMessage(error, message);
  }

  if (requestId && status && status >= 500) {
    message = `${message} (Request ID: ${requestId})`;
  }

  return new ApiRequestError(
    {
      message,
      status,
      requestId: requestId || undefined,
      baseUrl,
    },
    { cause: error },
  );
}

if (process.env.API_ERRORS_SELF_CHECK === "1") {
  const cases: Array<{ input: string; expect: string }> = [
    {
      input: "Network Error",
      expect: API_CONNECTION_ERROR_MESSAGE,
    },
    {
      input: "timeout of 15000ms exceeded",
      expect: API_CONNECTION_ERROR_MESSAGE,
    },
    {
      input: "Health probe failed for https://api.example.com:8000 with status 502",
      expect: API_CONNECTION_ERROR_MESSAGE,
    },
    {
      input: "Invalid username or password.",
      expect: "Invalid username or password.",
    },
    {
      input: "Name: Field required",
      expect: "Name: Field required",
    },
  ];

  for (const { input, expect } of cases) {
    const actual = sanitizeUserFacingMessage(input);
    if (actual !== expect) {
      throw new Error(`sanitizeUserFacingMessage(${JSON.stringify(input)}) = ${JSON.stringify(actual)}, expected ${JSON.stringify(expect)}`);
    }
  }
}
