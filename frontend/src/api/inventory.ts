import { apiClient } from "@/api/client";
import {
  InventoryAddRequest,
  InventoryMovementCreateResult,
  InventoryMovementPage,
  InventoryMovementSplitCreateResult,
  InventorySummaryRead,
  InventoryUseRequest,
  InventoryUseSplitRequest,
  UUID,
} from "@/types/api";

export async function fetchShopInventory() {
  const { data } = await apiClient.get<InventorySummaryRead>("/api/v1/shop/inventory");
  return data;
}

export async function fetchShopInventoryMovements(limit = 30) {
  const { data } = await apiClient.get<InventoryMovementPage>("/api/v1/shop/inventory/movements", {
    params: { limit },
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
