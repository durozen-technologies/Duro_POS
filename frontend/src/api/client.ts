import axios, { CanceledError, type InternalAxiosRequestConfig, isAxiosError } from "axios";

import {
  API_BASE_URL,
  API_BASE_URL_FALLBACKS,
  API_BASE_URL_STORAGE_KEY,
  CONFIGURED_API_BASE_URL,
} from "@/constants/config";
import { getSessionAbortSignal, logout, useAuthStore } from "@/store/auth-store";
import { secureStorage } from "@/utils/secure-storage";
import {
  HEALTHCHECK_PATH,
  isLoginRequestPath,
  isPublicRequestPath,
  normalizeRequestPath,
} from "@/utils/api-request-path";
import { isAuthRevocationError } from "@/utils/auth-errors";

export type ApiError = {
  message: string;
  status?: number;
  requestId?: string;
  baseUrl?: string;
};

const API_CONNECTION_ERROR_MESSAGE = "Unable to connect to the server. Please check your internet connection and try again. Otherwise, contact your administrator.";

export { API_CONNECTION_ERROR_MESSAGE };

const NETWORK_ERROR_PATTERN =
  /network request failed|network error|failed to fetch|cannot reach backend|unable to connect/i;

export function isNetworkConnectionError(error: unknown) {
  if (isAxiosError(error) && !error.response) {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return (
    NETWORK_ERROR_PATTERN.test(message) ||
    message === API_CONNECTION_ERROR_MESSAGE
  );
}

const HTTP_ERROR_MAP: Partial<Record<number, string>> = {
  401: "Session expired. Please sign in again.",
  403: "Access denied. Please contact your administrator.",
  429: "Too many requests. Please wait a moment before retrying.",
  500: "A server error occurred. Please try again later.",
  502: "Service temporarily unavailable. Please try again shortly.",
  503: "Service temporarily unavailable. Please try again shortly.",
};

type RetryableAxiosConfig = InternalAxiosRequestConfig & {
  _baseUrlCandidates?: string[];
  _remainingBaseUrlFallbacks?: string[];
  _retriedAfterProbe?: boolean;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const FAILOVER_REQUEST_TIMEOUT_MS = 3500;
const PROBE_REQUEST_TIMEOUT_MS = 1200;
const ADMIN_ITEMS_REQUEST_TIMEOUT_MS = 7000;
const ADMIN_ITEMS_COUNT_TIMEOUT_MS = 3500;
const UPLOAD_REQUEST_TIMEOUT_MS = 90000;
const API_FIELD_LABELS: Record<string, string> = {
  base_unit: "Base unit",
  amount: "Amount",
  category: "Category",
  category_id: "Category",
  custom_attributes: "Custom attributes",
  expense_item_id: "Expense item",
  image: "Image",
  is_active: "Active status",
  name: "English name",
  note: "Note",
  remove_image: "Remove image",
  sort_order: "Sort order",
  spent_at: "Spent at",
  tamil_name: "Tamil name",
  unit_type: "Unit type",
};

let lastReachableBaseUrl = "";
let hydratedStoredBaseUrl = false;
let storedBaseUrlPromise: Promise<void> | null = null;
let resolvingBaseUrlPromise: Promise<string> | null = null;
let apiConnectionSnapshot: ApiConnectionSnapshot = {
  status: "degraded",
  baseUrl: API_BASE_URL || CONFIGURED_API_BASE_URL || "",
  message: "",
  checkedAt: 0,
};
const apiConnectionListeners = new Set<() => void>();

export type ApiConnectionStatus = "healthy" | "degraded" | "offline";

export type ApiConnectionSnapshot = {
  status: ApiConnectionStatus;
  baseUrl: string;
  message: string;
  checkedAt: number;
};

function uniqueNonEmpty(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function emitApiConnectionChange() {
  apiConnectionListeners.forEach((listener) => listener());
}

function setApiConnectionSnapshot(nextSnapshot: ApiConnectionSnapshot) {
  apiConnectionSnapshot = nextSnapshot;
  emitApiConnectionChange();
}

function updateApiConnectionStatus(
  status: ApiConnectionStatus,
  baseUrl: string,
  message = "",
) {
  setApiConnectionSnapshot({
    status,
    baseUrl: baseUrl.trim(),
    message,
    checkedAt: Date.now(),
  });
}

export function getApiConnectionSnapshot() {
  return apiConnectionSnapshot;
}

export function subscribeApiConnection(listener: () => void) {
  apiConnectionListeners.add(listener);
  return () => {
    apiConnectionListeners.delete(listener);
  };
}

function getDisplayedApiBaseUrl() {
  return (
    lastReachableBaseUrl ||
    apiClient.defaults.baseURL?.trim() ||
    CONFIGURED_API_BASE_URL ||
    API_BASE_URL ||
    ""
  );
}

function joinApiUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

export function resolveApiUrl(path: string) {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmedPath)) {
    return trimmedPath;
  }

  const baseUrl = getDisplayedApiBaseUrl().replace(/\/$/, "");
  if (!baseUrl) {
    return trimmedPath;
  }

  return joinApiUrl(baseUrl, trimmedPath);
}

export function resolveApiUrlCandidates(path: string) {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return [];
  }
  if (/^https?:\/\//i.test(trimmedPath)) {
    return [trimmedPath];
  }

  const retryConfig = {
    baseURL: apiClient.defaults.baseURL || API_BASE_URL || undefined,
  } as RetryableAxiosConfig;
  const candidateUrls = getBaseUrlCandidates(retryConfig).map((baseUrl) => joinApiUrl(baseUrl, trimmedPath));

  return uniqueNonEmpty([resolveApiUrl(trimmedPath), ...candidateUrls]);
}

export async function resolveReachableApiUrlCandidates(path: string) {
  const trimmedPath = path.trim();
  if (!trimmedPath || /^https?:\/\//i.test(trimmedPath)) {
    return resolveApiUrlCandidates(trimmedPath);
  }

  const retryConfig = {
    baseURL: apiClient.defaults.baseURL || API_BASE_URL || undefined,
  } as RetryableAxiosConfig;
  try {
    const reachableBaseUrl = await resolveReachableBaseUrl(retryConfig);
    return uniqueNonEmpty([
      joinApiUrl(reachableBaseUrl, trimmedPath),
      ...resolveApiUrlCandidates(trimmedPath),
    ]);
  } catch {
    return resolveApiUrlCandidates(trimmedPath);
  }
}

export function getApiAuthHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function updateReachableBaseUrl(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.trim();
  if (!normalizedBaseUrl) {
    return;
  }

  lastReachableBaseUrl = normalizedBaseUrl;
  apiClient.defaults.baseURL = normalizedBaseUrl;
  updateApiConnectionStatus("healthy", normalizedBaseUrl);
}

async function persistReachableBaseUrl(baseUrl: string) {
  try {
    await secureStorage.setItem(API_BASE_URL_STORAGE_KEY, baseUrl);
  } catch {
    // Ignore storage failures and continue using the in-memory host.
  }
}

async function hydrateStoredReachableBaseUrl() {
  if (hydratedStoredBaseUrl) {
    return;
  }

  if (!storedBaseUrlPromise) {
    storedBaseUrlPromise = (async () => {
      try {
        const storedBaseUrl = (await secureStorage.getItem(API_BASE_URL_STORAGE_KEY))?.trim() || "";
        if (storedBaseUrl && [API_BASE_URL, ...API_BASE_URL_FALLBACKS].includes(storedBaseUrl)) {
          updateReachableBaseUrl(storedBaseUrl);
        }
      } finally {
        hydratedStoredBaseUrl = true;
        storedBaseUrlPromise = null;
      }
    })();
  }

  await storedBaseUrlPromise;
}

function getNetworkFailureMessage(_options: { upload?: boolean; baseUrl?: string } = {}) {
  return API_CONNECTION_ERROR_MESSAGE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getResponseFieldLabel(field: string) {
  const normalizedField = field.trim();
  if (!normalizedField) {
    return "";
  }
  return (
    API_FIELD_LABELS[normalizedField] ||
    normalizedField
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

function getValidationLocationLabel(location: unknown) {
  if (!Array.isArray(location) || location.length === 0) {
    return "";
  }

  const field = [...location]
    .reverse()
    .find((part) => typeof part === "string" && !["body", "form", "query", "path"].includes(part));

  return typeof field === "string" ? getResponseFieldLabel(field) : "";
}

function formatValidationDetailItem(item: unknown) {
  if (typeof item === "string") {
    return item;
  }
  if (!isRecord(item)) {
    return "";
  }

  const message =
    typeof item.msg === "string"
      ? item.msg
      : typeof item.message === "string"
        ? item.message
        : "";
  if (!message) {
    return "";
  }

  const locationLabel = getValidationLocationLabel(item.loc);
  return locationLabel ? `${locationLabel}: ${message}` : message;
}

function getResponseMessage(data: unknown) {
  if (!isRecord(data)) {
    return "";
  }

  const detail = data.detail;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail) && detail.length > 0) {
    const messages = detail.map(formatValidationDetailItem).filter(Boolean);
    if (messages.length > 0) {
      return messages.join("\n");
    }
  }
  if (typeof data.message === "string") {
    return data.message;
  }
  if (isRecord(data.error)) {
    const nestedMessage = data.error.message;
    if (typeof nestedMessage === "string" && nestedMessage.trim()) {
      return nestedMessage;
    }
  }
  if (typeof data.error === "string") {
    return data.error;
  }

  return "";
}

function isFormDataRequestBody(data: unknown) {
  return typeof FormData !== "undefined" && data instanceof FormData;
}

function isAdminItemsRequestPath(path: string) {
  return (
    path.startsWith("/api/v1/admin/items") ||
    path.startsWith("/api/v1/admin/inventory") ||
    path.startsWith("/api/v1/admin/item-categories") ||
    path.startsWith("/api/v1/shop/inventory") ||
    /\/api\/v1\/admin\/shops\/[^/]+\/(inventory-allocations|selected-items|item-import-candidates|items\/[^/]+|prices\/bootstrap)/.test(path) ||
    path === "/api/v1/admin/shops"
  );
}

function isAdminItemsCountRequestPath(path: string) {
  return path.endsWith("/counts") || path.includes("/counts?");
}

function shouldTryConfiguredUploadDirectly(config: RetryableAxiosConfig, candidates: string[]) {
  return isFormDataRequestBody(config.data) && candidates.length === 1 && !lastReachableBaseUrl;
}

function isUploadRequestConfig(config: RetryableAxiosConfig) {
  return isFormDataRequestBody(config.data);
}

function clearContentTypeHeader(headers: InternalAxiosRequestConfig["headers"]) {
  const mutableHeaders = headers as {
    delete?: (headerName: string) => void;
  } & Record<string, unknown>;

  if (typeof mutableHeaders.delete === "function") {
    mutableHeaders.delete("Content-Type");
    mutableHeaders.delete("content-type");
    return;
  }

  delete mutableHeaders["Content-Type"];
  delete mutableHeaders["content-type"];
}

function getBaseUrlCandidates(config: RetryableAxiosConfig) {
  if (config._baseUrlCandidates?.length) {
    return config._baseUrlCandidates;
  }

  const currentBaseUrl = config.baseURL || lastReachableBaseUrl || API_BASE_URL || "";
  const candidates = uniqueNonEmpty([currentBaseUrl, lastReachableBaseUrl, API_BASE_URL, ...API_BASE_URL_FALLBACKS]);

  config._baseUrlCandidates = candidates;
  return candidates;
}

type ProbeResult = {
  baseUrl: string;
  status: ApiConnectionStatus;
  message: string;
};

function probeBaseUrl(baseUrl: string) {
  return axios
    .get(`${baseUrl}${HEALTHCHECK_PATH}`, {
      timeout: PROBE_REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    })
    .then((response) => {
      // Accept healthy hosts and the backend's temporary startup/degraded state,
      // but reject unauthorized/error pages so failover does not lock onto them.
      if (response.status >= 200 && response.status < 300) {
        return {
          baseUrl,
          status: "healthy",
          message: "Backend health check passed.",
        } satisfies ProbeResult;
      }
      if (response.status === 503) {
        return {
          baseUrl,
          status: "degraded",
          message: "Backend is reachable but still starting or degraded.",
        } satisfies ProbeResult;
      }

      throw new Error(
        `Health probe failed for ${baseUrl} with status ${response.status}`,
      );
    });
}

function raceForFirstReachableBaseUrl(candidates: string[]) {
  return new Promise<ProbeResult>((resolve, reject) => {
    let rejectedCount = 0;
    let lastError: unknown = null;

    for (const candidate of candidates) {
      void probeBaseUrl(candidate)
        .then(resolve)
        .catch((error) => {
          rejectedCount += 1;
          lastError = error;

          if (rejectedCount === candidates.length) {
            reject(lastError);
          }
        });
    }
  });
}

async function resolveReachableBaseUrl(config: RetryableAxiosConfig, forceProbe = false) {
  await hydrateStoredReachableBaseUrl();

  const candidates = getBaseUrlCandidates(config);
  if (candidates.length === 0) {
    updateApiConnectionStatus("offline", "", API_CONNECTION_ERROR_MESSAGE);
    return "";
  }

  if (!forceProbe && lastReachableBaseUrl && candidates.includes(lastReachableBaseUrl)) {
    return lastReachableBaseUrl;
  }

  if (!forceProbe && apiConnectionSnapshot.status === "healthy" && apiConnectionSnapshot.checkedAt > 0) {
    return candidates[0];
  }

  if (!resolvingBaseUrlPromise) {
    resolvingBaseUrlPromise = raceForFirstReachableBaseUrl(candidates)
      .then((result) => {
        updateReachableBaseUrl(result.baseUrl);
        updateApiConnectionStatus(result.status, result.baseUrl, result.message);
        void persistReachableBaseUrl(result.baseUrl);
        return result.baseUrl;
      })
      .catch(() => {
        updateApiConnectionStatus("offline", candidates[0], API_CONNECTION_ERROR_MESSAGE);
        throw new Error(getNetworkFailureMessage());
      })
      .finally(() => {
        resolvingBaseUrlPromise = null;
      });
  }

  return resolvingBaseUrlPromise;
}

export async function probeApiConnection() {
  const retryConfig = {
    baseURL: apiClient.defaults.baseURL || API_BASE_URL || undefined,
  } as RetryableAxiosConfig;
  try {
    await resolveReachableBaseUrl(retryConfig, true);
  } catch {
    // The snapshot is updated by resolveReachableBaseUrl.
  }
  return getApiConnectionSnapshot();
}

function getNextFallbackBaseUrl(config: RetryableAxiosConfig) {
  const currentBaseUrl = config.baseURL || lastReachableBaseUrl || API_BASE_URL || "";
  const remainingFallbacks =
    config._remainingBaseUrlFallbacks ?? getBaseUrlCandidates(config).filter((baseUrl) => baseUrl !== currentBaseUrl);
  const [nextBaseUrl, ...rest] = remainingFallbacks;

  config._remainingBaseUrlFallbacks = rest;

  return nextBaseUrl;
}

function getErrorMessage(error: unknown) {
  if (!isAxiosError(error)) {
    if (error instanceof Error) {
      if (/network request failed|network error|failed to fetch/i.test(error.message)) {
        return getNetworkFailureMessage();
      }

      return error.message || "Something went wrong. Please try again.";
    }

    if (typeof error === "string" && error.trim().length > 0) {
      return error;
    }

    return "Something went wrong. Please try again.";
  }

  if (!error.response) {
    return getNetworkFailureMessage({
      upload: isFormDataRequestBody(error.config?.data),
      baseUrl: error.config?.baseURL?.trim(),
    });
  }

  const status = error.response.status;
  if (status && HTTP_ERROR_MAP[status]) {
    return HTTP_ERROR_MAP[status]!;
  }

  const responseMessage = getResponseMessage(error.response.data);
  if (responseMessage) {
    return responseMessage;
  }
  return error.message || "Request failed";
}

function getErrorStatus(error: unknown): number | undefined {
  if (isAxiosError(error)) {
    return error.response?.status;
  }
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

export function formatApiErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  const message = toApiError(error).message.trim();
  return message || fallback;
}

export function toApiError(error: unknown): ApiError {
  if (isApiRequestCanceled(error)) {
    return { message: "Request canceled." };
  }

  const status = getErrorStatus(error);
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
  const message = getErrorMessage(error);
  const messageWithRequestId =
    requestId && status && status >= 500 ? `${message} (Request ID: ${requestId})` : message;
  return {
    message: messageWithRequestId,
    status,
    requestId: requestId || undefined,
    baseUrl,
  };
}

export function isApiRequestCanceled(error: unknown) {
  return isAxiosError(error) && (error.code === "ERR_CANCELED" || error.name === "CanceledError");
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL || undefined,
  timeout: DEFAULT_REQUEST_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.request.use(async (config) => {
  if (!CONFIGURED_API_BASE_URL && !API_BASE_URL) {
    throw new Error(API_CONNECTION_ERROR_MESSAGE);
  }

  const retryConfig = config as RetryableAxiosConfig;
  const baseUrlCandidates = getBaseUrlCandidates(retryConfig);
  const requestPath = normalizeRequestPath(config.url);
  const isUploadRequest = isFormDataRequestBody(config.data);
  const shouldBypassProbe = shouldTryConfiguredUploadDirectly(retryConfig, baseUrlCandidates);
  const resolvedBaseUrl =
    config.baseURL ||
    (shouldBypassProbe ? baseUrlCandidates[0] : await resolveReachableBaseUrl(retryConfig)) ||
    baseUrlCandidates[0];
  const activeBaseUrl = resolvedBaseUrl;
  const remainingFallbacks = baseUrlCandidates.filter((baseUrl) => baseUrl !== activeBaseUrl);

  config.baseURL = activeBaseUrl;
  retryConfig._remainingBaseUrlFallbacks = remainingFallbacks;
  if (isUploadRequest && shouldBypassProbe) {
    updateApiConnectionStatus(
      "degraded",
      activeBaseUrl,
      "Trying configured backend directly for image upload.",
    );
  }

  const fallbackTimeout =
    remainingFallbacks.length > 0 && (!lastReachableBaseUrl || activeBaseUrl !== lastReachableBaseUrl)
      ? FAILOVER_REQUEST_TIMEOUT_MS
      : DEFAULT_REQUEST_TIMEOUT_MS;
  if (isUploadRequest) {
    config.timeout = UPLOAD_REQUEST_TIMEOUT_MS;
  } else if (isAdminItemsCountRequestPath(requestPath)) {
    config.timeout = Math.min(fallbackTimeout, ADMIN_ITEMS_COUNT_TIMEOUT_MS);
  } else if (isAdminItemsRequestPath(requestPath)) {
    config.timeout = Math.min(fallbackTimeout, ADMIN_ITEMS_REQUEST_TIMEOUT_MS);
  } else {
    config.timeout = fallbackTimeout;
  }

  const token = useAuthStore.getState().token;
  const isPublic = isPublicRequestPath(requestPath);

  if (!isPublic) {
    if (!config.signal) {
      config.signal = getSessionAbortSignal();
    }
    if (!token) {
      return Promise.reject(new CanceledError("Session ended"));
    }
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (isUploadRequest) {
    clearContentTypeHeader(config.headers);
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    const resolvedBaseUrl = response.config.baseURL?.trim();
    if (resolvedBaseUrl) {
      updateReachableBaseUrl(resolvedBaseUrl);
      void persistReachableBaseUrl(resolvedBaseUrl);
    }

    return response;
  },
  async (error) => {
    if (isApiRequestCanceled(error)) {
      return Promise.reject(error);
    }

    if (isAxiosError(error) && !error.response && error.config) {
      const retryConfig = error.config as RetryableAxiosConfig;
      const isUploadRequest = isUploadRequestConfig(retryConfig);
      updateApiConnectionStatus(
        "offline",
        retryConfig.baseURL || getDisplayedApiBaseUrl(),
        API_CONNECTION_ERROR_MESSAGE,
      );
      if (!isUploadRequest && !retryConfig._retriedAfterProbe) {
        retryConfig._retriedAfterProbe = true;
        try {
          const reachableBaseUrl = await resolveReachableBaseUrl(retryConfig, true);
          if (reachableBaseUrl) {
            retryConfig.baseURL = reachableBaseUrl;
            return apiClient.request(retryConfig);
          }
        } catch {
          // Fall through to configured fallback handling and original rejection.
        }
      }
      const nextBaseUrl = getNextFallbackBaseUrl(retryConfig);

      if (nextBaseUrl) {
        retryConfig.baseURL = nextBaseUrl;
        return apiClient.request(retryConfig);
      }
    }

    if (
      isAxiosError(error) &&
      useAuthStore.getState().token &&
      !isLoginRequestPath(normalizeRequestPath(error.config?.url))
    ) {
      const status = error.response?.status;
      if (status === 401 || isAuthRevocationError(error)) {
        void logout();
      }
    }
    return Promise.reject(error);
  },
);
