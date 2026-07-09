import { apiClient } from "@/api/client";
import type {
  RetailerInventoryPurchaseCreate,
  RetailerInventoryPurchasePage,
  RetailerInventoryPurchaseRead,
  UUID,
} from "@/types/api";

export type FetchShopRetailerInventoryPurchaseParams = {
  retailer_id?: UUID;
  reference_date?: string | null;
  range_start_date?: string | null;
  range_end_date?: string | null;
  limit?: number;
};

export async function createShopRetailerInventoryPurchase(
  payload: RetailerInventoryPurchaseCreate,
) {
  const { data } = await apiClient.post<RetailerInventoryPurchaseRead>(
    "/api/v1/shop/inventory/retailer-purchases",
    payload,
  );
  return data;
}

export async function fetchShopRetailerInventoryPurchases(
  params?: FetchShopRetailerInventoryPurchaseParams,
) {
  const { data } = await apiClient.get<RetailerInventoryPurchasePage>(
    "/api/v1/shop/inventory/retailer-purchases",
    {
      params: {
        retailer_id: params?.retailer_id ?? undefined,
        reference_date: params?.reference_date ?? undefined,
        range_start_date: params?.range_start_date ?? undefined,
        range_end_date: params?.range_end_date ?? undefined,
        limit: params?.limit ?? 30,
      },
    },
  );
  return data;
}

export async function fetchAdminRetailerInventoryPurchases(
  retailerId: UUID,
  params?: { limit?: number },
) {
  const { data } = await apiClient.get<RetailerInventoryPurchasePage>(
    `/api/v1/admin/retailers/${retailerId}/inventory-purchases`,
    {
      params: {
        limit: params?.limit ?? 30,
      },
    },
  );
  return data;
}
