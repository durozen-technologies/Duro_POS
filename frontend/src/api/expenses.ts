import * as FileSystem from "expo-file-system/legacy";

import { describeHttpError } from "@/api/api-errors";
import { apiClient, getApiAuthHeaders, resolveReachableApiUrlCandidates, API_CONNECTION_ERROR_MESSAGE } from "@/api/client";
import type {
  ExpenseEntryCreate,
  ExpenseEntryPage,
  ExpenseEntryRead,
  ExpenseEntryUpdate,
  ExpenseItemCounts,
  ExpenseItemCreate,
  ExpenseItemRead,
  ExpenseItemRowsPage,
  ExpenseItemUpdate,
  ShopExpenseAllocationBulkCreate,
  ShopExpenseAllocationBulkRead,
  ShopExpenseAllocationUpdate,
  ShopExpenseItemRead,
  ShopExpenseItemRowsPage,
  ShopExpenseItemsOrderRead,
  ShopExpenseItemsOrderUpdate,
  UUID,
} from "@/types/api";

export type ExpenseItemImageUploadFile = {
  uri: string;
  name: string;
  type: string;
};

export type ExpenseCursorParams = {
  q?: string;
  active?: boolean | null;
  limit?: number;
  cursor_sort_order?: number | null;
  cursor_name?: string | null;
  cursor_id?: UUID | null;
};

export type ExpenseHistoryParams = {
  shop_id?: UUID | null;
  range_start_date?: string | null;
  range_end_date?: string | null;
  limit?: number;
  cursor_spent_at?: string | null;
  cursor_id?: UUID | null;
};

function rowParams(params?: ExpenseCursorParams) {
  return {
    q: params?.q || undefined,
    active: params?.active ?? undefined,
    limit: params?.limit ?? 50,
    cursor_sort_order: params?.cursor_sort_order ?? undefined,
    cursor_name: params?.cursor_name ?? undefined,
    cursor_id: params?.cursor_id ?? undefined,
  };
}

function historyParams(params?: ExpenseHistoryParams) {
  return {
    shop_id: params?.shop_id ?? undefined,
    range_start_date: params?.range_start_date ?? undefined,
    range_end_date: params?.range_end_date ?? undefined,
    limit: params?.limit ?? 50,
    cursor_spent_at: params?.cursor_spent_at ?? undefined,
    cursor_id: params?.cursor_id ?? undefined,
  };
}

function parseUploadResponseBody(body: string) {
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return {};
  }
}

function getUploadResponseMessage(body: unknown) {
  if (!body || typeof body !== "object") {
    return "";
  }
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") {
    return detail;
  }
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

async function assertUploadFileReady(file: ExpenseItemImageUploadFile) {
  const info = await FileSystem.getInfoAsync(file.uri);
  if (!info.exists || info.isDirectory) {
    throw new Error("Selected image file is no longer available. Pick the image again and save.");
  }
}

async function uploadExpenseItemImageFile(path: string, file: ExpenseItemImageUploadFile) {
  const uploadUrls = await resolveReachableApiUrlCandidates(path);
  if (uploadUrls.length === 0) {
    throw new Error(API_CONNECTION_ERROR_MESSAGE);
  }
  await assertUploadFileReady(file);

  let lastError: unknown = null;
  for (const uploadUrl of uploadUrls) {
    try {
      const response = await FileSystem.uploadAsync(uploadUrl, file.uri, {
        fieldName: "image",
        headers: {
          Accept: "application/json",
          ...getApiAuthHeaders(),
        },
        httpMethod: "PUT",
        mimeType: file.type,
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      });
      const body = parseUploadResponseBody(response.body);
      if (response.status >= 200 && response.status < 300) {
        return body as ExpenseItemRead;
      }
      throw new Error(
        getUploadResponseMessage(body) ||
          describeHttpError(response.status, "Unable to upload the image. Please try again."),
      );
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Image upload failed before the backend responded.");
}

export async function fetchExpenseItemRows(
  params?: ExpenseCursorParams,
  options: { signal?: AbortSignal } = {},
) {
  const { data } = await apiClient.get<ExpenseItemRowsPage>("/api/v1/admin/expenses/items", {
    params: rowParams(params),
    signal: options.signal,
  });
  return data;
}

export async function fetchExpenseItemCounts(
  params?: Pick<ExpenseCursorParams, "q">,
  options: { signal?: AbortSignal } = {},
) {
  const { data } = await apiClient.get<ExpenseItemCounts>("/api/v1/admin/expenses/items/counts", {
    params: { q: params?.q || undefined },
    signal: options.signal,
  });
  return data;
}

export async function createExpenseItem(payload: ExpenseItemCreate) {
  const { data } = await apiClient.post<ExpenseItemRead>("/api/v1/admin/expenses/items", payload);
  return data;
}

export async function updateExpenseItem(itemId: UUID, payload: ExpenseItemUpdate) {
  const { data } = await apiClient.patch<ExpenseItemRead>(`/api/v1/admin/expenses/items/${itemId}`, payload);
  return data;
}

export async function deleteExpenseItem(itemId: UUID) {
  await apiClient.delete(`/api/v1/admin/expenses/items/${itemId}`);
}

export async function replaceExpenseItemImageFile(itemId: UUID, file: ExpenseItemImageUploadFile) {
  return uploadExpenseItemImageFile(`/api/v1/admin/expenses/items/${itemId}/image`, file);
}

export async function deleteExpenseItemImage(itemId: UUID) {
  const { data } = await apiClient.delete<ExpenseItemRead>(`/api/v1/admin/expenses/items/${itemId}/image`);
  return data;
}

export async function fetchShopExpenseItemRows(
  shopId: UUID,
  params?: ExpenseCursorParams,
  options: { signal?: AbortSignal } = {},
) {
  const { data } = await apiClient.get<ShopExpenseItemRowsPage>(
    `/api/v1/admin/shops/${shopId}/expense-items`,
    {
      params: rowParams(params),
      signal: options.signal,
    },
  );
  return data;
}

export async function fetchShopExpenseItemCounts(
  shopId: UUID,
  params?: Pick<ExpenseCursorParams, "q">,
  options: { signal?: AbortSignal } = {},
) {
  const { data } = await apiClient.get<ExpenseItemCounts>(
    `/api/v1/admin/shops/${shopId}/expense-items/counts`,
    {
      params: { q: params?.q || undefined },
      signal: options.signal,
    },
  );
  return data;
}

export async function fetchShopExpenseItemCandidateRows(
  shopId: UUID,
  params?: ExpenseCursorParams,
  options: { signal?: AbortSignal } = {},
) {
  const { data } = await apiClient.get<ExpenseItemRowsPage>(
    `/api/v1/admin/shops/${shopId}/expense-item-candidates`,
    {
      params: rowParams(params),
      signal: options.signal,
    },
  );
  return data;
}

export async function allocateShopExpenseItems(shopId: UUID, itemIds: UUID[]) {
  const payload: ShopExpenseAllocationBulkCreate = { expense_item_ids: itemIds };
  const { data } = await apiClient.post<ShopExpenseAllocationBulkRead>(
    `/api/v1/admin/shops/${shopId}/expense-items/allocations`,
    payload,
  );
  return data;
}

export async function allocateShopExpenseItem(shopId: UUID, itemId: UUID) {
  const { data } = await apiClient.post<ShopExpenseItemRead>(
    `/api/v1/admin/shops/${shopId}/expense-items/${itemId}/allocation`,
  );
  return data;
}

export async function updateShopExpenseAllocation(
  shopId: UUID,
  itemId: UUID,
  payload: ShopExpenseAllocationUpdate,
) {
  const { data } = await apiClient.patch<ShopExpenseItemRead>(
    `/api/v1/admin/shops/${shopId}/expense-items/${itemId}/allocation`,
    payload,
  );
  return data;
}

export async function deallocateShopExpenseItem(shopId: UUID, itemId: UUID) {
  const { data } = await apiClient.delete<ShopExpenseItemRead>(
    `/api/v1/admin/shops/${shopId}/expense-items/${itemId}/allocation`,
  );
  return data;
}

export async function updateShopExpenseItemsOrder(shopId: UUID, payload: ShopExpenseItemsOrderUpdate) {
  const { data } = await apiClient.put<ShopExpenseItemsOrderRead>(
    `/api/v1/admin/shops/${shopId}/expense-items/order`,
    payload,
  );
  return data;
}

export async function fetchAdminExpenseHistory(
  params?: ExpenseHistoryParams,
  options: { signal?: AbortSignal } = {},
) {
  const { data } = await apiClient.get<ExpenseEntryPage>("/api/v1/admin/expenses/history", {
    params: historyParams(params),
    signal: options.signal,
  });
  return data;
}

export async function updateAdminExpenseEntry(entryId: UUID, payload: ExpenseEntryUpdate) {
  const { data } = await apiClient.patch<ExpenseEntryRead>(
    `/api/v1/admin/expenses/history/${entryId}`,
    payload,
  );
  return data;
}

export async function fetchCurrentShopExpenseItems(
  params?: ExpenseCursorParams,
  options: { signal?: AbortSignal } = {},
) {
  const { data } = await apiClient.get<ShopExpenseItemRowsPage>("/api/v1/shop/expenses/items", {
    params: rowParams(params),
    signal: options.signal,
  });
  return data;
}

export async function createShopExpenseEntry(payload: ExpenseEntryCreate) {
  const { data } = await apiClient.post<ExpenseEntryRead>("/api/v1/shop/expenses/entries", payload);
  return data;
}

export async function fetchShopExpenseHistory(
  params?: Omit<ExpenseHistoryParams, "shop_id">,
  options: { signal?: AbortSignal } = {},
) {
  const { data } = await apiClient.get<ExpenseEntryPage>("/api/v1/shop/expenses/history", {
    params: historyParams(params),
    signal: options.signal,
  });
  return data;
}
