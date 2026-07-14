import Constants from "expo-constants";
import { Platform } from "react-native";

type ProcessEnvShape = {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

type ExpoExtraShape = {
  expoPublicApiBaseUrl?: string;
};

const envApiBaseUrl = (globalThis as ProcessEnvShape).process?.env?.EXPO_PUBLIC_API_BASE_URL?.trim();

type ConstantsShape = typeof Constants & {
  manifest?: {
    extra?: ExpoExtraShape;
  };
  manifest2?: {
    extra?: ExpoExtraShape;
  };
  executionEnvironment?: string | null;
};

function getExpoConfiguredApiBaseUrl() {
  const constants = Constants as ConstantsShape;

  return (
    (Constants.expoConfig?.extra as ExpoExtraShape | undefined)?.expoPublicApiBaseUrl?.trim() ||
    constants.manifest?.extra?.expoPublicApiBaseUrl?.trim() ||
    constants.manifest2?.extra?.expoPublicApiBaseUrl?.trim() ||
    ""
  );
}

const expoExtraApiBaseUrl = getExpoConfiguredApiBaseUrl();

function isExpoTunnelHost(host: string) {
  const normalizedHost = host.trim().toLowerCase();

  return (
    normalizedHost.endsWith(".exp.direct") ||
    normalizedHost.endsWith(".exp.host") ||
    normalizedHost.includes("anonymous")
  );
}

function withHttpProtocol(value: string) {
  return /^https?:\/\//i.test(value) ? value : `http://${value}`;
}

function isLocalhostLikeHost(host: string) {
  const normalizedHost = host.trim().toLowerCase();

  return normalizedHost === "localhost" || normalizedHost === "127.0.0.1" || normalizedHost === "0.0.0.0";
}

function isPrivateIpv4Host(host: string) {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) {
    return false;
  }

  const octets = match.slice(1).map((octet) => Number(octet));
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function normalizeApiBaseUrl(value: string) {
  if (!value.trim()) {
    return "";
  }

  try {
    return new URL(withHttpProtocol(value)).toString().replace(/\/$/, "");
  } catch {
    return withHttpProtocol(value).replace(/\/$/, "");
  }
}

function replaceApiBaseUrlHost(value: string, nextHost: string) {
  try {
    const url = new URL(withHttpProtocol(value));
    url.hostname = nextHost;
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function getExpoDevHost() {
  const hostUri = Constants.expoConfig?.hostUri?.trim() || "";
  if (!hostUri) {
    return "";
  }

  return hostUri.split(":")[0]?.trim() || "";
}

function uniqueNonEmpty(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export const EXPO_TUNNEL_DETECTED = Boolean(
  Constants.expoConfig?.hostUri && isExpoTunnelHost(Constants.expoConfig.hostUri.split(":")[0] ?? ""),
);

const configuredApiBaseUrl = envApiBaseUrl || expoExtraApiBaseUrl || "";

const normalizedConfiguredApiBaseUrl = normalizeApiBaseUrl(configuredApiBaseUrl);
const expoDevHost = getExpoDevHost();

function getApiBaseUrlCandidates(baseUrl: string) {
  if (!baseUrl) {
    return [];
  }

  if (Platform.OS !== "android") {
    return [baseUrl];
  }

  try {
    const url = new URL(baseUrl);
    const currentHost = url.hostname;
    const isLocalhostHost = isLocalhostLikeHost(currentHost);
    const isPrivateHost = isPrivateIpv4Host(currentHost);
    const candidates: string[] = [];

    if (isLocalhostHost || isPrivateHost) {
      const emulatorUrl = replaceApiBaseUrlHost(baseUrl, "10.0.2.2");
      const expoHostUrl =
        expoDevHost && expoDevHost !== currentHost && !isLocalhostLikeHost(expoDevHost)
          ? replaceApiBaseUrlHost(baseUrl, expoDevHost)
          : "";

      if (isLocalhostHost) {
        candidates.push(emulatorUrl, expoHostUrl, baseUrl);
      } else {
        candidates.push(baseUrl, expoHostUrl, emulatorUrl);
      }
    } else {
      candidates.push(baseUrl);
    }

    return uniqueNonEmpty(candidates);
  } catch {
    return [baseUrl];
  }
}

const apiBaseUrlCandidates = getApiBaseUrlCandidates(normalizedConfiguredApiBaseUrl);

export const CONFIGURED_API_BASE_URL = normalizedConfiguredApiBaseUrl;
export const API_BASE_URL = apiBaseUrlCandidates[0] ?? normalizedConfiguredApiBaseUrl;
export const API_BASE_URL_FALLBACKS = apiBaseUrlCandidates.slice(1);
export const API_BASE_URL_STORAGE_KEY = "meat-billing-api-base-url";
export const AUTH_STORAGE_KEY = "meat-billing-auth";
export const PRINTER_STORAGE_KEY = "meat-billing-printer";
export const SHOP_LANGUAGE_STORAGE_KEY = "meat-billing-shop-language";
export const SHOP_BILLS_PAGE_SIZE_STORAGE_KEY = "meat-billing-shop-bills-page-size";
export const ADMIN_THEME_STORAGE_KEY = "meat-billing-admin-theme";
export const ADMIN_ITEMS_STORAGE_KEY = "meat-billing-admin-items";
