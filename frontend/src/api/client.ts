import axios, { type InternalAxiosRequestConfig, isAxiosError } from "axios";
import { Platform } from "react-native";

import {
  API_BASE_URL,
  API_BASE_URL_FALLBACKS,
  API_BASE_URL_STORAGE_KEY,
  CONFIGURED_API_BASE_URL,
  EXPO_TUNNEL_DETECTED,
} from "@/constants/config";
import { useAuthStore } from "@/store/auth-store";
import { useCartStore } from "@/store/cart-store";
import { usePriceStore } from "@/store/price-store";
import { secureStorage } from "@/utils/secure-storage";

export type ApiError = {
  message: string;
  status?: number;
};

type RetryableAxiosConfig = InternalAxiosRequestConfig & {
  _baseUrlCandidates?: string[];
  _remainingBaseUrlFallbacks?: string[];
};

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const FAILOVER_REQUEST_TIMEOUT_MS = 3500;
const PROBE_REQUEST_TIMEOUT_MS = 1200;
const HEALTHCHECK_PATH = "/api/v1/health";

let lastReachableBaseUrl = "";
let hydratedStoredBaseUrl = false;
let storedBaseUrlPromise: Promise<void> | null = null;
let resolvingBaseUrlPromise: Promise<string> | null = null;

function uniqueNonEmpty(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
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

  return `${baseUrl}/${trimmedPath.replace(/^\//, "")}`;
}

function updateReachableBaseUrl(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.trim();
  if (!normalizedBaseUrl) {
    return;
  }

  lastReachableBaseUrl = normalizedBaseUrl;
  apiClient.defaults.baseURL = normalizedBaseUrl;
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

function getNetworkFailureMessage() {
  const displayedApiBaseUrl = getDisplayedApiBaseUrl();

  if (!displayedApiBaseUrl) {
    return "API base URL is not configured. Set EXPO_PUBLIC_API_BASE_URL and restart Expo.";
  }

  if (EXPO_TUNNEL_DETECTED) {
    return `Cannot reach API at ${displayedApiBaseUrl}. Expo tunnel shares the app bundle only, not your backend on port 8000. Set EXPO_PUBLIC_API_BASE_URL to a public URL for the backend, or switch Expo to LAN and use your computer's Wi-Fi IP.`;
  }

  if (Platform.OS === "web") {
    return `Cannot reach API at ${displayedApiBaseUrl}. If the backend is up, this is usually a browser CORS block. Add your frontend origin to CORS_ORIGINS on the backend and redeploy.`;
  }

  return `Cannot reach API at ${displayedApiBaseUrl}. Check that the backend is running and avoid localhost or 127.0.0.1 from Expo Go on Android. Use your computer's LAN IP or let the app rewrite it automatically.`;
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

function probeBaseUrl(baseUrl: string) {
  return axios
    .get(`${baseUrl}${HEALTHCHECK_PATH}`, {
      timeout: PROBE_REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    })
    .then((response) => {
      // Accept healthy hosts and the backend's temporary startup/degraded state,
      // but reject unauthorized/error pages so failover does not lock onto them.
      if (
        (response.status >= 200 && response.status < 300) ||
        response.status === 503
      ) {
        return baseUrl;
      }

      throw new Error(
        `Health probe failed for ${baseUrl} with status ${response.status}`,
      );
    });
}

function raceForFirstReachableBaseUrl(candidates: string[]) {
  return new Promise<string>((resolve, reject) => {
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

async function resolveReachableBaseUrl(config: RetryableAxiosConfig) {
  await hydrateStoredReachableBaseUrl();

  const candidates = getBaseUrlCandidates(config);
  if (candidates.length === 0) {
    return "";
  }

  if (lastReachableBaseUrl && candidates.includes(lastReachableBaseUrl)) {
    return lastReachableBaseUrl;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  if (!resolvingBaseUrlPromise) {
    resolvingBaseUrlPromise = raceForFirstReachableBaseUrl(candidates)
      .then((reachableBaseUrl) => {
        updateReachableBaseUrl(reachableBaseUrl);
        void persistReachableBaseUrl(reachableBaseUrl);
        return reachableBaseUrl;
      })
      .catch(() => candidates[0])
      .finally(() => {
        resolvingBaseUrlPromise = null;
      });
  }

  return resolvingBaseUrlPromise;
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
    return getNetworkFailureMessage();
  }

  const detail = error.response?.data?.detail;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail) && detail.length > 0) {
    return detail.map((item) => item.msg).join(", ");
  }
  return error.message || "Request failed";
}

export function toApiError(error: unknown): ApiError {
  return {
    message: getErrorMessage(error),
    status: isAxiosError(error) ? error.response?.status : undefined,
  };
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
    throw new Error("API base URL is not configured. Set EXPO_PUBLIC_API_BASE_URL and restart Expo.");
  }

  const retryConfig = config as RetryableAxiosConfig;
  const baseUrlCandidates = getBaseUrlCandidates(retryConfig);
  const resolvedBaseUrl = config.baseURL || (await resolveReachableBaseUrl(retryConfig)) || baseUrlCandidates[0];
  const activeBaseUrl = resolvedBaseUrl;
  const remainingFallbacks = baseUrlCandidates.filter((baseUrl) => baseUrl !== activeBaseUrl);

  config.baseURL = activeBaseUrl;
  retryConfig._remainingBaseUrlFallbacks = remainingFallbacks;

  config.timeout =
    remainingFallbacks.length > 0 && (!lastReachableBaseUrl || activeBaseUrl !== lastReachableBaseUrl)
      ? FAILOVER_REQUEST_TIMEOUT_MS
      : DEFAULT_REQUEST_TIMEOUT_MS;

  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
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
  (error) => {
    if (isAxiosError(error) && !error.response && error.config) {
      const retryConfig = error.config as RetryableAxiosConfig;
      const nextBaseUrl = getNextFallbackBaseUrl(retryConfig);

      if (nextBaseUrl) {
        retryConfig.baseURL = nextBaseUrl;
        return apiClient.request(retryConfig);
      }
    }

    if (isAxiosError(error) && error.response?.status === 401) {
      useAuthStore.getState().clearSession();
      useCartStore.getState().resetCart();
      usePriceStore.getState().clear();
    }
    return Promise.reject(error);
  },
);
