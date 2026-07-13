import * as FileSystem from "expo-file-system/legacy";

import { apiClient, getApiAuthHeaders, resolveReachableApiUrlCandidates, API_CONNECTION_ERROR_MESSAGE } from "@/api/client";
import {
  AdminItemRowsPage,
  AdminBillPage,
  AnalyticsPeriod,
  AdminDashboardBootstrap,
  BaseUnit,
  BillRead,
  BillEditRequest,
  DailyPriceCreate,
  DailyPriceRead,
  DailyPriceUpdate,
  InventoryCategoryCreate,
  InventoryCategoryRead,
  InventoryCategoryUpdate,
  InventoryItemCounts,
  InventoryItemImageRead,
  InventoryItemRead,
  InventoryItemRowsPage,
  InventoryPurchaseRatesConfirmRead,
  InventoryBillingItemMappingWrite,
  InventoryItemStockRead,
  InventoryMovementPage,
  InventoryStockRowsPage,
  InventorySummaryRead,
  RetailerInventoryUsagePage,
  ItemAssumptionUpdate,
  ItemCategoryCreate,
  ItemCategoryRead,
  ItemCategoryUpdate,
  ItemImageRead,
  ItemMetadataUpdate,
  ItemRead,
  ItemScope,
  ItemSalesSummary,
  OverallReportRead,
  PaymentSplitSummary,
  PriceStatus,
  ShopBootstrapResponse,
  ShopCreate,
  ShopInventoryAllocationBulkCreate,
  ShopInventoryAllocationBulkRead,
  ShopInventoryAllocationUpdate,
  ShopItemAllocationBulkCreate,
  ShopItemAllocationBulkRead,
  ShopItemAllocationUpdate,
  ShopItemCounts,
  ShopItemPage,
  ShopItemRead,
  ShopSelectedItemsOrderRead,
  ShopSelectedItemsOrderUpdate,
  ShopRead,
  ShopSalesSummary,
  ShopStatusUpdate,
  ShopUpdate,
  UnitType,
  UUID,
  TransferShopCreate,
  TransferShopUpdate,
  TransferShopRead,
  InventoryTransferPage,
} from "@/types/api";

export type ItemImageUploadFile = {
  uri: string;
  name: string;
  type: string;
};
export type ItemMultipartFields = Record<string, string>;
export type InventoryItemMetadataPayload = {
  name: string;
  tamil_name: string;
  unit_type: UnitType;
  base_unit: BaseUnit;
  is_active: boolean;
  sort_order: number;
  category_ids: UUID[];
  billing_item_id?: UUID | null;
  billing_item_ids: UUID[];
  billing_mappings: InventoryBillingItemMappingWrite[];
  global_image_template_id?: UUID | null;
  use_global_image_template?: boolean;
};

export type AnalyticsDateRange = {
  startDate?: string | null;
  endDate?: string | null;
};
export type AdminReportSection = "sales" | "billing" | "expenses" | "transfers" | "retailers" | "over_report";
export type AdminReportDetailLevel = "summary" | "full";
export type DownloadAdminReportPdfParams = {
  sections: AdminReportSection[];
  detailLevel?: AdminReportDetailLevel;
  period: AnalyticsPeriod;
  referenceDate?: string | null;
  range?: AnalyticsDateRange;
  shopIds?: UUID[];
  retailerIds?: UUID[];
  language?: "en" | "ta";
};
export type FetchOverallReportParams = Omit<DownloadAdminReportPdfParams, "sections">;
export type DownloadAdminReportPdfResult = {
  uri: string;
  filename: string;
};

function analyticsParams(period: AnalyticsPeriod, referenceDate?: string, range?: AnalyticsDateRange) {
  return {
    period,
    reference_date: referenceDate,
    range_start_date: range?.startDate ?? undefined,
    range_end_date: range?.endDate ?? undefined,
  };
}

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
  if (record.error && typeof record.error === "object" && !Array.isArray(record.error)) {
    const errorObj = record.error as Record<string, unknown>;
    if (typeof errorObj.message === "string" && errorObj.message.trim()) {
      return errorObj.message;
    }
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

class DownloadHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "DownloadHttpError";
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

export async function updateItemCategory(categoryId: UUID, payload: ItemCategoryUpdate) {
  const { data } = await apiClient.patch<ItemCategoryRead>(`/api/v1/admin/item-categories/${categoryId}`, payload);
  return data;
}

export async function deleteItemCategory(categoryId: UUID) {
  await apiClient.delete(`/api/v1/admin/item-categories/${categoryId}`);
}

export async function fetchInventoryCategories(options: ApiRequestOptions = {}) {
  const { data } = await apiClient.get<InventoryCategoryRead[]>("/api/v1/admin/inventory/categories", {
    signal: options.signal,
  });
  return data;
}

export async function createInventoryCategory(payload: InventoryCategoryCreate) {
  const { data } = await apiClient.post<InventoryCategoryRead>("/api/v1/admin/inventory/categories", payload);
  return data;
}

export async function updateInventoryCategory(categoryId: UUID, payload: InventoryCategoryUpdate) {
  const { data } = await apiClient.patch<InventoryCategoryRead>(
    `/api/v1/admin/inventory/categories/${categoryId}`,
    payload,
  );
  return data;
}

export async function deleteInventoryCategory(categoryId: UUID) {
  await apiClient.delete(`/api/v1/admin/inventory/categories/${categoryId}`);
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

export async function fetchAdminBillDetails(billIds: UUID[]) {
  const { data } = await apiClient.post<BillRead[]>("/api/v1/admin/bills/details", {
    bill_ids: billIds,
  });
  return data;
}

export async function editAdminBill(billId: UUID, payload: BillEditRequest) {
  const { data } = await apiClient.patch<BillRead>(`/api/v1/admin/bills/${billId}`, payload);
  return data;
}

export async function cancelAdminBill(billId: UUID) {
  const { data } = await apiClient.post<BillRead>(`/api/v1/admin/bills/${billId}/cancel`);
  return data;
}

function appendAdminReportFilterQuery(query: URLSearchParams, params: FetchOverallReportParams) {
  query.set("detail_level", params.detailLevel ?? "summary");
  query.set("period", params.period);
  if (params.referenceDate) {
    query.set("reference_date", params.referenceDate);
  }
  if (params.range?.startDate) {
    query.set("range_start_date", params.range.startDate);
  }
  if (params.range?.endDate) {
    query.set("range_end_date", params.range.endDate);
  }
  params.shopIds?.forEach((shopId) => query.append("shop_ids", shopId));
  params.retailerIds?.forEach((retailerId) => query.append("retailer_ids", retailerId));
}

function buildAdminReportQuery(params: DownloadAdminReportPdfParams) {
  const query = new URLSearchParams();
  params.sections.forEach((section) => query.append("sections", section));
  appendAdminReportFilterQuery(query, params);
  if (params.language && params.language !== "en") {
    query.set("language", params.language);
  }
  return query.toString();
}

function buildOverallReportQuery(params: FetchOverallReportParams) {
  const query = new URLSearchParams();
  appendAdminReportFilterQuery(query, params);
  return query.toString();
}

function buildAdminReportFilename() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `admin-report-${timestamp}.pdf`;
}

async function readDownloadedErrorMessage(uri: string) {
  try {
    const body = await FileSystem.readAsStringAsync(uri);
    const parsed = parseUploadResponseBody(body);
    return getUploadResponseMessage(parsed);
  } catch {
    return "";
  }
}

export async function downloadAdminReportPdf(
  params: DownloadAdminReportPdfParams,
): Promise<DownloadAdminReportPdfResult> {
  if (params.sections.length === 0) {
    throw new Error("Select at least one report section.");
  }
  const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!baseDirectory) {
    throw new Error("File storage is not available on this device.");
  }
  const filename = buildAdminReportFilename();
  const localUri = `${baseDirectory}${filename}`;
  const query = buildAdminReportQuery(params);
  const downloadUrls = await resolveReachableApiUrlCandidates(`/api/v1/admin/reports/pdf?${query}`);
  if (downloadUrls.length === 0) {
    throw new Error(API_CONNECTION_ERROR_MESSAGE);
  }

  let lastNetworkError: unknown = null;
  for (const [index, downloadUrl] of downloadUrls.entries()) {
    try {
      const response = await FileSystem.downloadAsync(downloadUrl, localUri, {
        headers: {
          Accept: "application/pdf",
          ...getApiAuthHeaders(),
        },
      });
      if (response.status >= 200 && response.status < 300) {
        return { uri: response.uri, filename };
      }
      const message = await readDownloadedErrorMessage(response.uri);
      await FileSystem.deleteAsync(response.uri, { idempotent: true }).catch(() => undefined);
      throw new DownloadHttpError(message || `Report download failed with status ${response.status}.`, response.status);
    } catch (error) {
      if (error instanceof DownloadHttpError) {
        throw error;
      }
      lastNetworkError = error;
      if (index < downloadUrls.length - 1) {
        continue;
      }
    }
  }

  if (lastNetworkError instanceof Error && lastNetworkError.message) {
    throw new Error(API_CONNECTION_ERROR_MESSAGE);
  }
  throw new Error(API_CONNECTION_ERROR_MESSAGE);
}

export async function fetchAdminOverallReport(
  params: FetchOverallReportParams,
  options: ApiRequestOptions = {},
) {
  const query = buildOverallReportQuery(params);
  const { data } = await apiClient.get<OverallReportRead>(`/api/v1/admin/reports/overall?${query}`, {
    signal: options.signal,
  });
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
  category_id?: UUID | null;
  uncategorized?: boolean | null;
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
    category_id: params?.category_id ?? undefined,
    uncategorized: params?.uncategorized ?? undefined,
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
    {
      params: {
        q: params?.q || undefined,
        category_id: params?.category_id ?? undefined,
        uncategorized: params?.uncategorized ?? undefined,
      },
      signal: options.signal,
    },
  );
  return data;
}

export async function fetchSelectedShopItemsPage(shopId: UUID, params?: FetchShopItemsParams) {
  const { data } = await apiClient.get<ShopItemPage>(`/api/v1/admin/shops/${shopId}/selected-items`, {
    params: {
      q: params?.q || undefined,
      category_id: params?.category_id ?? undefined,
      uncategorized: params?.uncategorized ?? undefined,
      limit: params?.limit ?? 100,
      cursor_sort_order: params?.cursor_sort_order ?? undefined,
      cursor_name: params?.cursor_name ?? undefined,
      cursor_id: params?.cursor_id ?? undefined,
    },
  });
  return data;
}

export async function updateSelectedShopItemsOrder(
  shopId: UUID,
  payload: ShopSelectedItemsOrderUpdate,
) {
  const { data } = await apiClient.put<ShopSelectedItemsOrderRead>(
    `/api/v1/admin/shops/${shopId}/selected-items/order`,
    payload,
  );
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

export type FetchInventoryItemsParams = {
  q?: string;
  active?: boolean | null;
  limit?: number;
  cursor_sort_order?: number | null;
  cursor_name?: string | null;
  cursor_id?: UUID | null;
  cursor_is_active?: boolean | null;
};

export interface InventoryItemPurchaseRateHistoryRead {
  inventory_item_id: UUID;
  purchase_rate: string;
};

export async function fetchInventoryItemRows(
  params?: FetchInventoryItemsParams,
  options: ApiRequestOptions = {},
) {
  const { data } = await apiClient.get<InventoryItemRowsPage>("/api/v1/admin/inventory/items/rows", {
    params: {
      q: params?.q || undefined,
      active: params?.active ?? undefined,
      limit: params?.limit ?? 50,
      cursor_sort_order: params?.cursor_sort_order ?? undefined,
      cursor_name: params?.cursor_name ?? undefined,
      cursor_id: params?.cursor_id ?? undefined,
      cursor_is_active: params?.cursor_is_active ?? undefined,
    },
    signal: options.signal,
  });
  return data;
}

export async function fetchInventoryItemCounts(
  params?: Pick<FetchInventoryItemsParams, "q" | "active">,
  options: ApiRequestOptions = {},
) {
  const { data } = await apiClient.get<InventoryItemCounts>("/api/v1/admin/inventory/items/counts", {
    params: {
      q: params?.q || undefined,
      active: params?.active ?? undefined,
    },
    signal: options.signal,
  });
  return data;
}

export type FetchInventoryStockRowsParams = {
  q?: string;
  active?: boolean | null;
  limit?: number;
  cursor_sort_order?: number | null;
  cursor_name?: string | null;
  cursor_id?: UUID | null;
};

export async function fetchInventoryItem(itemId: UUID, options: ApiRequestOptions = {}) {
  const { data } = await apiClient.get<InventoryItemRead>(`/api/v1/admin/inventory/items/${itemId}`, {
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
    throw new Error(API_CONNECTION_ERROR_MESSAGE);
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
    throw new Error(API_CONNECTION_ERROR_MESSAGE);
  }
  throw new Error(API_CONNECTION_ERROR_MESSAGE);
}

export async function createItemWithImageFile(payload: ItemMultipartFields, file: ItemImageUploadFile) {
  return uploadItemMultipartFile<ItemRead>("/api/v1/admin/items", file, "POST", payload);
}

export async function createInventoryItemMetadata(payload: InventoryItemMetadataPayload) {
  const { data } = await apiClient.post<InventoryItemRead>("/api/v1/admin/inventory/items/metadata", payload);
  return data;
}

export async function updateItem(itemId: UUID, payload: FormData) {
  const { data } = await apiClient.patch<ItemRead>(`/api/v1/admin/items/${itemId}`, payload);
  return data;
}

export async function updateItemWithImageFile(itemId: UUID, payload: ItemMultipartFields, file: ItemImageUploadFile) {
  return uploadItemMultipartFile<ItemRead>(`/api/v1/admin/items/${itemId}`, file, "PATCH", payload);
}

export async function updateInventoryItemMetadata(itemId: UUID, payload: InventoryItemMetadataPayload) {
  const { data } = await apiClient.patch<InventoryItemRead>(
    `/api/v1/admin/inventory/items/${itemId}/metadata`,
    payload,
  );
  return data;
}

export async function updateInventoryItemPurchaseRate(itemId: UUID, purchaseRate: string) {
  const { data } = await apiClient.patch<InventoryItemRead>(
    `/api/v1/admin/inventory/items/${itemId}/purchase-rate`,
    { purchase_rate: purchaseRate },
  );
  return data;
}

export async function confirmInventoryPurchaseRatesToday() {
  const { data } = await apiClient.post<InventoryPurchaseRatesConfirmRead>(
    "/api/v1/admin/inventory/items/purchase-rates/confirm-today",
  );
  return data;
}

export async function fetchInventoryPurchaseRatesHistory(referenceDate: string) {
  const { data } = await apiClient.get<InventoryItemPurchaseRateHistoryRead[]>(
    "/api/v1/admin/inventory/items/purchase-rates/history",
    { params: { reference_date: referenceDate } },
  );
  return data;
}

export async function replaceInventoryItemImageFile(itemId: UUID, file: ItemImageUploadFile) {
  return uploadItemMultipartFile<InventoryItemImageRead>(
    `/api/v1/admin/inventory/items/${itemId}/image`,
    file,
    "PUT",
  );
}

export async function deleteInventoryItemImage(itemId: UUID) {
  const { data } = await apiClient.delete<InventoryItemImageRead>(
    `/api/v1/admin/inventory/items/${itemId}/image`,
  );
  return data;
}

export async function updateItemMetadata(itemId: UUID, payload: ItemMetadataUpdate) {
  const { data } = await apiClient.patch<ItemRead>(`/api/v1/admin/items/${itemId}/metadata`, payload);
  return data;
}

export async function updateItemAssumption(itemId: UUID, payload: ItemAssumptionUpdate) {
  const { data } = await apiClient.patch<ItemRead>(`/api/v1/admin/items/${itemId}/assumption`, payload);
  return data;
}

export type ConfirmDeletePayload = {
  username: string;
  password: string;
};

/** Prefer POST — some clients strip DELETE bodies. */
export async function deleteItem(itemId: UUID, payload: ConfirmDeletePayload) {
  await apiClient.post(`/api/v1/admin/items/${itemId}/confirm-delete`, payload);
}

export async function deleteInventoryItem(itemId: UUID) {
  await apiClient.delete(`/api/v1/admin/inventory/items/${itemId}`);
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

/** Prefer POST — some clients strip DELETE bodies. */
export async function deleteShopItem(shopId: UUID, itemId: UUID, payload: ConfirmDeletePayload) {
  await apiClient.post(`/api/v1/admin/shops/${shopId}/items/${itemId}/confirm-delete`, payload);
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

export async function fetchShopInventoryAllocations(shopId: UUID, options: ApiRequestOptions = {}) {
  const { data } = await apiClient.get<InventorySummaryRead>(
    `/api/v1/admin/shops/${shopId}/inventory-allocations`,
    { signal: options.signal },
  );
  return data;
}

export async function fetchShopInventoryAllocationRows(
  shopId: UUID,
  params?: FetchInventoryStockRowsParams,
  options: ApiRequestOptions = {},
) {
  const { data } = await apiClient.get<InventoryStockRowsPage>(
    `/api/v1/admin/shops/${shopId}/inventory-allocations/rows`,
    {
      params: {
        q: params?.q || undefined,
        active: params?.active ?? undefined,
        limit: params?.limit ?? 50,
        cursor_sort_order: params?.cursor_sort_order ?? undefined,
        cursor_name: params?.cursor_name ?? undefined,
        cursor_id: params?.cursor_id ?? undefined,
      },
      signal: options.signal,
    },
  );
  return data;
}

export async function allocateShopInventoryItems(shopId: UUID, itemIds: UUID[]) {
  const payload: ShopInventoryAllocationBulkCreate = { item_ids: itemIds };
  const { data } = await apiClient.post<ShopInventoryAllocationBulkRead>(
    `/api/v1/admin/shops/${shopId}/inventory-allocations`,
    payload,
  );
  return data;
}

export async function updateShopInventoryAllocation(shopId: UUID, payload: ShopInventoryAllocationUpdate) {
  const { data } = await apiClient.patch<InventoryItemStockRead>(
    `/api/v1/admin/shops/${shopId}/inventory-allocations`,
    payload,
  );
  return data;
}

export type InventoryStockAdjustRequest = {
  available_quantity?: string | null;
  available_bird_count?: number | null;
  used_quantity?: string | null;
  used_bird_count?: number | null;
  transfer_quantity?: string | null;
  transfer_bird_count?: number | null;
  category_id?: string | null;
  occurred_at?: string | null;
};

export async function adminSetShopInventoryStock(
  shopId: UUID,
  itemId: UUID,
  payload: InventoryStockAdjustRequest,
) {
  const { data } = await apiClient.patch<InventoryItemStockRead>(
    `/api/v1/admin/shops/${shopId}/inventory-allocations/${itemId}/stock`,
    payload,
  );
  return data;
}

export type RetailerStockAdjustRequest = {
  retailer_used_quantity?: string | null;
  retailer_used_bird_count?: number | null;
  category_id?: string | null;
  retailer_id?: string | null;
  occurred_at?: string | null;
  adjustment_reason?: string | null;
};

export async function adminSetRetailerInventoryStock(
  shopId: UUID,
  itemId: UUID,
  payload: RetailerStockAdjustRequest,
) {
  const { data } = await apiClient.patch<InventoryItemStockRead>(
    `/api/v1/admin/shops/${shopId}/inventory-allocations/${itemId}/retailer-stock`,
    payload,
  );
  return data;
}

export async function fetchAdminRetailerInventoryUsages(
  params?: {
    shop_id?: UUID | null;
    item_id?: UUID | null;
    reference_date?: string | null;
    range_start_date?: string | null;
    range_end_date?: string | null;
    limit?: number;
  },
  options: ApiRequestOptions = {},
) {
  const { data } = await apiClient.get<RetailerInventoryUsagePage>(
    "/api/v1/admin/inventory/retailer-usages",
    {
      params: {
        shop_id: params?.shop_id ?? undefined,
        item_id: params?.item_id ?? undefined,
        reference_date: params?.reference_date ?? undefined,
        range_start_date: params?.range_start_date ?? undefined,
        range_end_date: params?.range_end_date ?? undefined,
        limit: params?.limit ?? 100,
      },
      signal: options.signal,
    },
  );
  return data;
}

export async function fetchAdminInventorySummary(shopId: UUID, options: ApiRequestOptions = {}) {
  const { data } = await apiClient.get<InventorySummaryRead>("/api/v1/admin/inventory/summary", {
    params: { shop_id: shopId },
    signal: options.signal,
  });
  return data;
}

export async function fetchAdminInventoryMovements(
  params?: {
    shop_id?: UUID | null;
    item_id?: UUID | null;
    category_id?: UUID | null;
    reference_date?: string | null;
    range_start_date?: string | null;
    range_end_date?: string | null;
    limit?: number;
  },
  options: ApiRequestOptions = {},
) {
  const { data } = await apiClient.get<InventoryMovementPage>("/api/v1/admin/inventory/movements", {
    params: {
      shop_id: params?.shop_id ?? undefined,
      item_id: params?.item_id ?? undefined,
      category_id: params?.category_id ?? undefined,
      reference_date: params?.reference_date ?? undefined,
      range_start_date: params?.range_start_date ?? undefined,
      range_end_date: params?.range_end_date ?? undefined,
      limit: params?.limit ?? 100,
    },
    signal: options.signal,
  });
  return data;
}

export async function fetchSalesSummary(period: AnalyticsPeriod, referenceDate?: string, range?: AnalyticsDateRange) {
  const { data } = await apiClient.get<ShopSalesSummary[]>("/api/v1/admin/sales-summary", {
    params: analyticsParams(period, referenceDate, range),
  });
  return data;
}

export async function fetchPaymentSummary(period: AnalyticsPeriod, referenceDate?: string, range?: AnalyticsDateRange) {
  const { data } = await apiClient.get<PaymentSplitSummary[]>("/api/v1/admin/payment-summary", {
    params: analyticsParams(period, referenceDate, range),
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
  range?: AnalyticsDateRange,
) {
  const { data } = await apiClient.get<AdminBillPage>("/api/v1/admin/bills", {
    params: {
      ...analyticsParams(period, referenceDate, range),
      shop_id: shopId ?? undefined,
      limit,
      cursor_created_at: cursorCreatedAt ?? undefined,
      cursor_id: cursorId ?? undefined,
    },
  });
  return data;
}

export async function fetchItemSales(
  period: AnalyticsPeriod,
  referenceDate?: string,
  shopId?: UUID | null,
  range?: AnalyticsDateRange,
) {
  const { data } = await apiClient.get<ItemSalesSummary[]>("/api/v1/admin/item-sales", {
    params: { ...analyticsParams(period, referenceDate, range), shop_id: shopId ?? undefined },
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

export async function fetchShopPriceHistory(shopId: UUID, priceDate: string, options: ApiRequestOptions = {}) {
  const { data } = await apiClient.get<ShopBootstrapResponse>(
    `/api/v1/admin/shops/${shopId}/prices/history`,
    {
      params: { price_date: priceDate },
      signal: options.signal,
    },
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
  range?: AnalyticsDateRange,
) {
  const { data } = await apiClient.get<AdminDashboardBootstrap>("/api/v1/admin/dashboard/bootstrap", {
    params: {
      ...analyticsParams(period, referenceDate, range),
      shop_id: shopId ?? undefined,
      bills_limit: limit,
    },
  });
  return data;
}

export async function fetchTransferShops(
  params?: { q?: string; active?: boolean | null },
  options: ApiRequestOptions = {},
) {
  const { data } = await apiClient.get<TransferShopRead[]>("/api/v1/admin/transfer-shops", {
    params: {
      q: params?.q || undefined,
      active: params?.active ?? undefined,
    },
    signal: options.signal,
  });
  return data;
}

export async function createTransferShop(payload: TransferShopCreate) {
  const { data } = await apiClient.post<TransferShopRead>("/api/v1/admin/transfer-shops", payload);
  return data;
}

export async function updateTransferShop(id: UUID, payload: TransferShopUpdate) {
  const { data } = await apiClient.patch<TransferShopRead>(`/api/v1/admin/transfer-shops/${id}`, payload);
  return data;
}

export async function deleteTransferShop(id: UUID) {
  await apiClient.delete(`/api/v1/admin/transfer-shops/${id}`);
}

export async function fetchInventoryTransfersPage(
  params?: {
    transfer_shop_id?: UUID;
    source_shop_id?: UUID;
    inventory_item_id?: UUID;
    referenceDate?: string;
    range?: AnalyticsDateRange;
    q?: string;
    unit?: string;
    quantity?: number | string;
    limit?: number;
    offset?: number;
  },
  options: ApiRequestOptions = {},
) {
  const { data } = await apiClient.get<InventoryTransferPage>("/api/v1/admin/inventory/transfers", {
    params: {
      transfer_shop_id: params?.transfer_shop_id ?? undefined,
      source_shop_id: params?.source_shop_id ?? undefined,
      inventory_item_id: params?.inventory_item_id ?? undefined,
      reference_date: params?.referenceDate ?? undefined,
      range_start_date: params?.range?.startDate ?? undefined,
      range_end_date: params?.range?.endDate ?? undefined,
      q: params?.q || undefined,
      unit: params?.unit || undefined,
      quantity: params?.quantity || undefined,
      limit: params?.limit ?? 100,
      offset: params?.offset ?? 0,
    },
    signal: options.signal,
  });
  return data;
}
