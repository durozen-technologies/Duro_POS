import { apiClient } from "@/api/client";
import {
  InventoryAddRequest,
  InventoryBackdatePolicyRead,
  InventoryBackdatePolicyUpdate,
  InventoryMovementCreateResult,
  InventoryMovementPage,
  InventoryMovementSplitCreateResult,
  InventoryStockRowsPage,
  InventorySummaryRead,
  InventoryUseRequest,
  InventoryUseSplitRequest,
  InventoryTransferCreate,
  InventoryTransferPage,
  InventoryTransferRead,
  TransferShopRead,
  UUID,
} from "@/types/api";

export async function fetchShopInventory() {
  const { data } = await apiClient.get<InventorySummaryRead>("/api/v1/shop/inventory");
  return data;
}

export type FetchShopInventoryRowsParams = {
  q?: string;
  limit?: number;
  cursor_sort_order?: number | null;
  cursor_name?: string | null;
  cursor_id?: UUID | null;
};

export async function fetchShopInventoryRows(params?: FetchShopInventoryRowsParams, options: { signal?: AbortSignal } = {}) {
  const { data } = await apiClient.get<InventoryStockRowsPage>("/api/v1/shop/inventory/items/rows", {
    params: {
      q: params?.q || undefined,
      limit: params?.limit ?? 50,
      cursor_sort_order: params?.cursor_sort_order ?? undefined,
      cursor_name: params?.cursor_name ?? undefined,
      cursor_id: params?.cursor_id ?? undefined,
    },
    signal: options.signal,
  });
  return data;
}

export type FetchShopInventoryMovementParams = {
  reference_date?: string | null;
  range_start_date?: string | null;
  range_end_date?: string | null;
  limit?: number;
};

export async function fetchShopInventoryMovements(params?: FetchShopInventoryMovementParams) {
  const { data } = await apiClient.get<InventoryMovementPage>("/api/v1/shop/inventory/movements", {
    params: {
      reference_date: params?.reference_date ?? undefined,
      range_start_date: params?.range_start_date ?? undefined,
      range_end_date: params?.range_end_date ?? undefined,
      limit: params?.limit ?? 30,
    },
  });
  return data;
}

export async function fetchShopInventoryTransfers(params?: FetchShopInventoryMovementParams) {
  const { data } = await apiClient.get<InventoryTransferPage>("/api/v1/shop/inventory/transfers", {
    params: {
      reference_date: params?.reference_date ?? undefined,
      range_start_date: params?.range_start_date ?? undefined,
      range_end_date: params?.range_end_date ?? undefined,
      limit: params?.limit ?? 30,
    },
  });
  return data;
}

export async function addShopInventoryStock(itemId: UUID, payload: InventoryAddRequest) {
  const { data } = await apiClient.post<InventoryMovementCreateResult>(
    `/api/v1/shop/inventory/items/${itemId}/add`,
    payload,
  );
  return data;
}

export async function useShopInventoryStock(itemId: UUID, payload: InventoryUseRequest) {
  const { data } = await apiClient.post<InventoryMovementCreateResult>(
    `/api/v1/shop/inventory/items/${itemId}/use`,
    payload,
  );
  return data;
}

export async function useShopInventoryStockSplit(itemId: UUID, payload: InventoryUseSplitRequest) {
  const { data } = await apiClient.post<InventoryMovementSplitCreateResult>(
    `/api/v1/shop/inventory/items/${itemId}/use-split`,
    payload,
  );
  return data;
}

export async function transferInventoryStock(itemId: UUID, payload: InventoryTransferCreate) {
  const { data } = await apiClient.post<InventoryTransferRead>(
    `/api/v1/shop/inventory/items/${itemId}/transfer`,
    payload,
  );
  return data;
}

export async function getActiveTransferShops() {
  const { data } = await apiClient.get<TransferShopRead[]>("/api/v1/shop/inventory/transfer-shops");
  return data;
}

export async function fetchShopInventoryBackdatePolicy() {
  const { data } = await apiClient.get<InventoryBackdatePolicyRead>(
    "/api/v1/shop/inventory/backdate-policy",
  );
  return data;
}

export async function fetchAdminInventoryBackdatePolicy() {
  const { data } = await apiClient.get<InventoryBackdatePolicyRead>(
    "/api/v1/admin/inventory/backdate-policy",
  );
  return data;
}

export async function updateAdminInventoryBackdatePolicy(payload: InventoryBackdatePolicyUpdate) {
  const { data } = await apiClient.put<InventoryBackdatePolicyRead>(
    "/api/v1/admin/inventory/backdate-policy",
    payload,
  );
  return data;
}
