import * as FileSystem from "expo-file-system/legacy";

import { apiClient, getApiAuthHeaders, resolveReachableApiUrlCandidates } from "@/api/client";
import {
  AdminItemRowsPage,
  AdminBillPage,
  AnalyticsPeriod,
  AdminDashboardBootstrap,
  BillRead,
  DailyPriceCreate,
  DailyPriceRead,
  DailyPriceUpdate,
  ItemCategoryCreate,
  ItemCategoryRead,
  ItemImageRead,
  ItemMetadataUpdate,
  ItemRead,
  ItemScope,
  ItemSalesSummary,
  PaymentSplitSummary,
  PriceStatus,
  ShopBootstrapResponse,
  ShopCreate,
  ShopItemAllocationBulkCreate,
  ShopItemAllocationBulkRead,
  ShopItemAllocationUpdate,
  ShopItemCounts,
  ShopItemPage,
  ShopItemRead,
  ShopRead,
  ShopSalesSummary,
  ShopStatusUpdate,
  ShopUpdate,
  UUID,
} from "@/types/api";

export type ItemImageUploadFile = {
  uri: string;
  name: string;
  type: string;
};
export type ItemMultipartFields = Record<string, string>;

function parseUploadResponseBody(body: string) {
  if (!body.trim()) {
    return null;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function getUploadResponseMessage(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "";
  }
  const record = body as Record<string, unknown>;
  if (typeof record.detail === "string") {
    return record.detail;
  }
  if (typeof record.message === "string") {
    return record.message;
  }
  if (typeof record.error === "string") {
    return record.error;
  }
  if (Array.isArray(record.detail)) {
    const messages = record.detail
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return "";
        }
        const detail = entry as Record<string, unknown>;
        return typeof detail.msg === "string" ? detail.msg : "";
      })
      .filter(Boolean);
    if (messages.length > 0) {
      return messages.join("\n");
    }
  }
  return "";
}

function getUploadAttemptSummary(uploadUrls: string[]) {
  const origins = uploadUrls.map((uploadUrl) => {
    try {
      return new URL(uploadUrl).origin;
    } catch {
      return uploadUrl;
    }
  });
  return Array.from(new Set(origins)).join(", ");
}

class UploadHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "UploadHttpError";
  }
}

class UploadFileUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadFileUnavailableError";
  }
}

function isLocalUploadFileError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /Directory for '.+' doesn't exist|No such file or directory|open failed: ENOENT|file .+ doesn't exist/i.test(
    message,
  );
}

async function assertUploadFileReady(file: ItemImageUploadFile) {
  const fileInfo = await FileSystem.getInfoAsync(file.uri);
  if (!fileInfo.exists) {
    throw new UploadFileUnavailableError(
      "Selected image file is no longer available. Pick the image again and save.",
    );
  }
  if (fileInfo.isDirectory) {
    throw new UploadFileUnavailableError("Selected image points to a folder. Pick an image file and save.");
  }
}

export async function createShop(payload: ShopCreate) {
  const { data } = await apiClient.post<ShopRead>("/api/v1/admin/shops", payload);
  return data;
}

export type ApiRequestOptions = {
  signal?: AbortSignal;
};

export async function fetchShops(options: ApiRequestOptions = {}) {
  const { data } = await apiClient.get<ShopRead[]>("/api/v1/admin/shops", {
    signal: options.signal,
  });
  return data;
}

export async function fetchItemCategories(options: ApiRequestOptions = {}) {
  const { data } = await apiClient.get<ItemCategoryRead[]>("/api/v1/admin/item-categories", {
    signal: options.signal,
  });
  return data;
}

export async function createItemCategory(payload: ItemCategoryCreate) {
  const { data } = await apiClient.post<ItemCategoryRead>("/api/v1/admin/item-categories", payload);
  return data;
}

export async function deleteItemCategory(categoryId: UUID) {
  await apiClient.delete(`/api/v1/admin/item-categories/${categoryId}`);
}

export async function updateShop(shopId: UUID, payload: ShopUpdate) {
  const { data } = await apiClient.patch<ShopRead>(`/api/v1/admin/shops/${shopId}`, payload);
  return data;
}

export async function updateShopStatus(shopId: UUID, payload: ShopStatusUpdate) {
  const { data } = await apiClient.patch<ShopRead>(`/api/v1/admin/shops/${shopId}/status`, payload);
  return data;
}

export async function fetchAdminBillDetail(billId: UUID) {
  const { data } = await apiClient.get<BillRead>(`/api/v1/admin/bills/${billId}`);
  return data;
}

export async function deleteShop(shopId: UUID) {
  await apiClient.delete(`/api/v1/admin/shops/${shopId}`);
}

export type FetchShopItemsParams = {
  q?: string;
  scope?: ItemScope;
  allocated?: boolean;
  priced?: boolean;
  price_status?: PriceStatus;
  active?: boolean;
  limit?: number;
  cursor_group?: number | null;
  cursor_sort_order?: number | null;
  cursor_name?: string | null;
  cursor_id?: UUID | null;
};

function itemRowParams(params?: FetchShopItemsParams) {
  return {
    q: params?.q || undefined,
    active: params?.active,
    limit: params?.limit ?? 50,
    cursor_sort_order: params?.cursor_sort_order ?? undefined,
    cursor_name: params?.cursor_name ?? undefined,
    cursor_id: params?.cursor_id ?? undefined,
  };
}

export async function fetchShopItemsPage(shopId: UUID, params?: FetchShopItemsParams) {
  const { data } = await apiClient.get<ShopItemPage>(`/api/v1/admin/shops/${shopId}/items`, {
    params: {
      q: params?.q || undefined,
      scope: params?.scope,
      allocated: params?.allocated,
      priced: params?.priced,
      price_status: params?.price_status,
      active: params?.active,
      limit: params?.limit ?? 100,
      cursor_group: params?.cursor_group ?? undefined,
      cursor_sort_order: params?.cursor_sort_order ?? undefined,
      cursor_name: params?.cursor_name ?? undefined,
      cursor_id: params?.cursor_id ?? undefined,
    },
  });
  return data;
}

export async function fetchSelectedShopItemRows(
  shopId: UUID,
  params?: FetchShopItemsParams,
  options: ApiRequestOptions = {},
) {
  const { data } = await apiClient.get<AdminItemRowsPage>(
    `/api/v1/admin/shops/${shopId}/selected-items/rows`,
    { params: itemRowParams(params), signal: options.signal },
  );
  return data;
}

export async function fetchSelectedShopItemCounts(
  shopId: UUID,
  params?: FetchShopItemsParams,
  options: ApiRequestOptions = {},
) {
  const { data } = await apiClient.get<ShopItemCounts>(
    `/api/v1/admin/shops/${shopId}/selected-items/counts`,
    { params: { q: params?.q || undefined }, signal: options.signal },
  );
  return data;
}

export async function fetchSelectedShopItemsPage(shopId: UUID, params?: FetchShopItemsParams) {
  const { data } = await apiClient.get<ShopItemPage>(`/api/v1/admin/shops/${shopId}/selected-items`, {
    params: {
      q: params?.q || undefined,
      limit: params?.limit ?? 100,
      cursor_sort_order: params?.cursor_sort_order ?? undefined,
      cursor_name: params?.cursor_name ?? undefined,
      cursor_id: params?.cursor_id ?? undefined,
    },
  });
  return data;
}

export async function fetchShopItemImportCandidateRows(
  shopId: UUID,
  params?: FetchShopItemsParams,
  options: ApiRequestOptions = {},
) {
  const { data } = await apiClient.get<AdminItemRowsPage>(
    `/api/v1/admin/shops/${shopId}/item-import-candidates/rows`,
    { params: itemRowParams(params), signal: options.signal },
  );
  return data;
}

export async function fetchShopItemImportCandidateCounts(
  shopId: UUID,
  params?: FetchShopItemsParams,
  options: ApiRequestOptions = {},
) {
  const { data } = await apiClient.get<ShopItemCounts>(
    `/api/v1/admin/shops/${shopId}/item-import-candidates/counts`,
    { params: { q: params?.q || undefined }, signal: options.signal },
  );
  return data;
}

export async function fetchShopItemImportCandidatesPage(shopId: UUID, params?: FetchShopItemsParams) {
  const { data } = await apiClient.get<ShopItemPage>(`/api/v1/admin/shops/${shopId}/item-import-candidates`, {
    params: {
      q: params?.q || undefined,
      limit: params?.limit ?? 100,
      cursor_sort_order: params?.cursor_sort_order ?? undefined,
      cursor_name: params?.cursor_name ?? undefined,
      cursor_id: params?.cursor_id ?? undefined,
    },
  });
  return data;
}

export async function fetchCatalogueItemRows(
  params?: FetchShopItemsParams,
  options: ApiRequestOptions = {},
) {
  const { data } = await apiClient.get<AdminItemRowsPage>("/api/v1/admin/items/rows", {
    params: itemRowParams(params),
    signal: options.signal,
  });
  return data;
}

export async function fetchCatalogueItemCounts(
  params?: FetchShopItemsParams,
  options: ApiRequestOptions = {},
) {
  const { data } = await apiClient.get<ShopItemCounts>("/api/v1/admin/items/counts", {
    params: {
      q: params?.q || undefined,
      active: params?.active,
    },
    signal: options.signal,
  });
  return data;
}

export async function fetchCatalogueItemsPage(params?: FetchShopItemsParams) {
  const { data } = await apiClient.get<ShopItemPage>("/api/v1/admin/items", {
    params: {
      q: params?.q || undefined,
      allocated: params?.allocated,
      active: params?.active,
      limit: params?.limit ?? 100,
      cursor_sort_order: params?.cursor_sort_order ?? undefined,
      cursor_name: params?.cursor_name ?? undefined,
      cursor_id: params?.cursor_id ?? undefined,
    },
  });
  return data;
}

export async function fetchCatalogueItem(itemId: UUID, options: ApiRequestOptions = {}) {
  const { data } = await apiClient.get<ShopItemRead>(`/api/v1/admin/items/${itemId}`, {
    signal: options.signal,
  });
  return data;
}

export async function fetchShopItem(shopId: UUID, itemId: UUID, options: ApiRequestOptions = {}) {
  const { data } = await apiClient.get<ShopItemRead>(`/api/v1/admin/shops/${shopId}/items/${itemId}`, {
    signal: options.signal,
  });
  return data;
}

export async function fetchShopItems(shopId: UUID, params?: FetchShopItemsParams) {
  const firstPage = await fetchShopItemsPage(shopId, params);
  return firstPage.items;
}

export async function createItem(payload: FormData) {
  const { data } = await apiClient.post<ItemRead>("/api/v1/admin/items", payload);
  return data;
}

async function uploadItemMultipartFile<TResponse>(
  path: string,
  file: ItemImageUploadFile,
  httpMethod: "POST" | "PUT" | "PATCH",
  parameters?: ItemMultipartFields,
) {
  const uploadUrls = await resolveReachableApiUrlCandidates(path);
  if (uploadUrls.length === 0) {
    throw new Error("API base URL is not configured. Set EXPO_PUBLIC_API_BASE_URL and restart Expo.");
  }
  await assertUploadFileReady(file);

  let lastNetworkError: unknown = null;
  for (const [index, uploadUrl] of uploadUrls.entries()) {
    try {
      const response = await FileSystem.uploadAsync(uploadUrl, file.uri, {
        fieldName: "image",
        headers: {
          Accept: "application/json",
          ...getApiAuthHeaders(),
        },
        httpMethod,
        mimeType: file.type,
        parameters,
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      });
      const body = parseUploadResponseBody(response.body);
      if (response.status >= 200 && response.status < 300) {
        return body as TResponse;
      }
      const message = getUploadResponseMessage(body);
      throw new UploadHttpError(message || `Image upload failed with status ${response.status}.`, response.status);
    } catch (error) {
      if (error instanceof UploadHttpError) {
        throw error;
      }
      if (error instanceof UploadFileUnavailableError || isLocalUploadFileError(error)) {
        throw new UploadFileUnavailableError(
          "Selected image file is no longer available. Pick the image again and save.",
        );
      }
      lastNetworkError = error;
      if (index < uploadUrls.length - 1) {
        continue;
      }
    }
  }

  if (lastNetworkError instanceof Error && lastNetworkError.message) {
    const attemptedTargets = getUploadAttemptSummary(uploadUrls);
    const attemptedMessage = attemptedTargets ? ` Tried ${attemptedTargets}.` : "";
    throw new Error(
      `Image upload could not reach backend API.${attemptedMessage} ${lastNetworkError.message}`,
    );
  }
  throw new Error("Image upload failed before the backend responded.");
}

export async function createItemWithImageFile(payload: ItemMultipartFields, file: ItemImageUploadFile) {
  return uploadItemMultipartFile<ItemRead>("/api/v1/admin/items", file, "POST", payload);
}

export async function updateItem(itemId: UUID, payload: FormData) {
  const { data } = await apiClient.patch<ItemRead>(`/api/v1/admin/items/${itemId}`, payload);
  return data;
}

export async function updateItemWithImageFile(itemId: UUID, payload: ItemMultipartFields, file: ItemImageUploadFile) {
  return uploadItemMultipartFile<ItemRead>(`/api/v1/admin/items/${itemId}`, file, "PATCH", payload);
}

export async function updateItemMetadata(itemId: UUID, payload: ItemMetadataUpdate) {
  const { data } = await apiClient.patch<ItemRead>(`/api/v1/admin/items/${itemId}/metadata`, payload);
  return data;
}

export async function deleteItem(itemId: UUID) {
  await apiClient.delete(`/api/v1/admin/items/${itemId}`);
}

export async function createShopItem(shopId: UUID, payload: FormData) {
  const { data } = await apiClient.post<ItemRead>(`/api/v1/admin/shops/${shopId}/items`, payload);
  return data;
}

export async function createShopItemWithImageFile(
  shopId: UUID,
  payload: ItemMultipartFields,
  file: ItemImageUploadFile,
) {
  return uploadItemMultipartFile<ItemRead>(`/api/v1/admin/shops/${shopId}/items`, file, "POST", payload);
}

export async function updateShopItem(shopId: UUID, itemId: UUID, payload: FormData) {
  const { data } = await apiClient.patch<ItemRead>(`/api/v1/admin/shops/${shopId}/items/${itemId}`, payload);
  return data;
}

export async function updateShopItemWithImageFile(
  shopId: UUID,
  itemId: UUID,
  payload: ItemMultipartFields,
  file: ItemImageUploadFile,
) {
  return uploadItemMultipartFile<ItemRead>(
    `/api/v1/admin/shops/${shopId}/items/${itemId}`,
    file,
    "PATCH",
    payload,
  );
}

export async function updateShopItemMetadata(shopId: UUID, itemId: UUID, payload: ItemMetadataUpdate) {
  const { data } = await apiClient.patch<ItemRead>(`/api/v1/admin/shops/${shopId}/items/${itemId}/metadata`, payload);
  return data;
}

export async function deleteShopItem(shopId: UUID, itemId: UUID) {
  await apiClient.delete(`/api/v1/admin/shops/${shopId}/items/${itemId}`);
}

export async function deleteItemImage(itemId: UUID) {
  const { data } = await apiClient.delete(`/api/v1/admin/items/${itemId}/image`);
  return data;
}

export async function replaceItemImage(itemId: UUID, payload: FormData) {
  const { data } = await apiClient.put<ItemImageRead>(`/api/v1/admin/items/${itemId}/image`, payload);
  return data;
}

export async function replaceItemImageFile(itemId: UUID, file: ItemImageUploadFile) {
  return uploadItemMultipartFile<ItemImageRead>(`/api/v1/admin/items/${itemId}/image`, file, "PUT");
}

export async function allocateShopItem(shopId: UUID, itemId: UUID) {
  const { data } = await apiClient.post<ShopItemRead>(`/api/v1/admin/shops/${shopId}/item-allocations/${itemId}`);
  return data;
}

export async function allocateShopItems(shopId: UUID, itemIds: UUID[]) {
  const payload: ShopItemAllocationBulkCreate = { item_ids: itemIds };
  const { data } = await apiClient.post<ShopItemAllocationBulkRead>(
    `/api/v1/admin/shops/${shopId}/item-allocations/bulk`,
    payload,
  );
  return data;
}

export async function deallocateShopItem(shopId: UUID, itemId: UUID) {
  const { data } = await apiClient.delete<ShopItemRead>(`/api/v1/admin/shops/${shopId}/item-allocations/${itemId}`);
  return data;
}

export async function updateShopItemAllocation(shopId: UUID, itemId: UUID, payload: ShopItemAllocationUpdate) {
  const { data } = await apiClient.patch<ShopItemRead>(
    `/api/v1/admin/shops/${shopId}/item-allocations/${itemId}`,
    payload,
  );
  return data;
}

export async function fetchSalesSummary(period: AnalyticsPeriod, referenceDate?: string) {
  const { data } = await apiClient.get<ShopSalesSummary[]>("/api/v1/admin/sales-summary", {
    params: { period, reference_date: referenceDate },
  });
  return data;
}

export async function fetchPaymentSummary(period: AnalyticsPeriod, referenceDate?: string) {
  const { data } = await apiClient.get<PaymentSplitSummary[]>("/api/v1/admin/payment-summary", {
    params: { period, reference_date: referenceDate },
  });
  return data;
}

export async function fetchDailyBills(
  period: AnalyticsPeriod,
  referenceDate?: string,
  shopId?: UUID | null,
  limit = 100,
  cursorCreatedAt?: string | null,
  cursorId?: UUID | null,
) {
  const { data } = await apiClient.get<AdminBillPage>("/api/v1/admin/bills", {
    params: {
      period,
      reference_date: referenceDate,
      shop_id: shopId ?? undefined,
      limit,
      cursor_created_at: cursorCreatedAt ?? undefined,
      cursor_id: cursorId ?? undefined,
    },
  });
  return data;
}

export async function fetchItemSales(period: AnalyticsPeriod, referenceDate?: string, shopId?: UUID | null) {
  const { data } = await apiClient.get<ItemSalesSummary[]>("/api/v1/admin/item-sales", {
    params: { period, reference_date: referenceDate, shop_id: shopId ?? undefined },
  });
  return data;
}

export async function fetchGlobalPriceBootstrap() {
  const { data } = await apiClient.get<ShopBootstrapResponse>("/api/v1/admin/prices/bootstrap");
  return data;
}

export async function saveGlobalDailyPrices(payload: DailyPriceCreate) {
  const { data } = await apiClient.post<DailyPriceRead[]>("/api/v1/admin/daily-prices", payload);
  return data;
}

export async function fetchShopPriceBootstrap(shopId: UUID, options: ApiRequestOptions = {}) {
  const { data } = await apiClient.get<ShopBootstrapResponse>(
    `/api/v1/admin/shops/${shopId}/prices/bootstrap`,
    { signal: options.signal },
  );
  return data;
}

export async function saveShopDailyPrices(shopId: UUID, payload: DailyPriceCreate) {
  const { data } = await apiClient.post<DailyPriceRead[]>(`/api/v1/admin/shops/${shopId}/daily-prices`, payload);
  return data;
}

export async function saveEditedShopDailyPrices(shopId: UUID, payload: DailyPriceCreate) {
  const { data } = await apiClient.patch<DailyPriceRead[]>(`/api/v1/admin/shops/${shopId}/daily-prices`, payload);
  return data;
}

export async function saveShopDailyPrice(shopId: UUID, itemId: UUID, payload: DailyPriceUpdate) {
  const { data } = await apiClient.put<DailyPriceRead>(
    `/api/v1/admin/shops/${shopId}/daily-prices/${itemId}`,
    payload,
  );
  return data;
}

export async function fetchDashboardBootstrap(
  period: AnalyticsPeriod,
  referenceDate?: string,
  shopId?: UUID | null,
  limit = 50,
) {
  const { data } = await apiClient.get<AdminDashboardBootstrap>("/api/v1/admin/dashboard/bootstrap", {
    params: {
      period,
      reference_date: referenceDate,
      shop_id: shopId ?? undefined,
      bills_limit: limit,
    },
  });
  return data;
}
