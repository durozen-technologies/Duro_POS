import { apiClient } from "@/api/client";
import type {
  RetailerBalanceRead,
  RetailerBranchAllocationRead,
  RetailerCreate,
  RetailerItemAllocationBulkRead,
  RetailerItemAllocationListRead,
  RetailerItemAllocationUpdate,
  RetailerItemPriceInput,
  RetailerItemPriceRead,
  RetailerPage,
  RetailerPaymentCreate,
  RetailerPaymentRecordResponse,
  RetailerRead,
  RetailerSaleEditRequest,
  RetailerSalePage,
  RetailerSaleRead,
  RetailerSaleReceiptPage,
  RetailerSaleReceiptRead,
  RetailerUpdate,
  RetailerWalletPayoutCreate,
  RetailerWalletPayoutRead,
  UUID,
} from "@/types/api";

export async function fetchRetailers(params?: {
  q?: string;
  active?: boolean;
  shop_id?: UUID;
  page?: number;
  page_size?: number;
}) {
  const { data } = await apiClient.get<RetailerPage>("/api/v1/admin/retailers", { params });
  return data;
}

export async function fetchAllRetailers(params?: {
  q?: string;
  active?: boolean;
  shop_id?: UUID;
}) {
  const pageSize = 100;
  let page = 1;
  let items: RetailerRead[] = [];
  let total = 0;

  do {
    const response = await fetchRetailers({ ...params, page, page_size: pageSize });
    if (response.items.length === 0) {
      break;
    }
    items = items.concat(response.items);
    total = response.total;
    page += 1;
  } while (items.length < total);

  return items;
}

export async function createRetailer(payload: RetailerCreate) {
  const { data } = await apiClient.post<RetailerRead>("/api/v1/admin/retailers", payload);
  return data;
}

export async function updateRetailer(retailerId: UUID, payload: RetailerUpdate) {
  const { data } = await apiClient.patch<RetailerRead>(
    `/api/v1/admin/retailers/${retailerId}`,
    payload,
  );
  return data;
}

export async function deleteRetailer(retailerId: UUID) {
  await apiClient.delete(`/api/v1/admin/retailers/${retailerId}`);
}

export async function fetchShopRetailerCatalog(
  shopId: UUID,
  params?: {
    q?: string;
    allocated?: "allocated" | "available";
    limit?: number;
  },
) {
  const { data } = await apiClient.get<RetailerItemAllocationListRead>(
    `/api/v1/admin/shops/${shopId}/retailer-catalog`,
    { params },
  );
  return data;
}

export async function syncShopRetailerCatalog(shopId: UUID, itemIds: UUID[]) {
  const { data } = await apiClient.put<RetailerItemAllocationListRead>(
    `/api/v1/admin/shops/${shopId}/retailer-catalog`,
    { item_ids: itemIds },
  );
  return data;
}

export async function fetchRetailerItemPrices(retailerId: UUID, shopId: UUID) {
  const { data } = await apiClient.get<RetailerItemPriceRead[]>(
    `/api/v1/admin/retailers/${retailerId}/items`,
    { params: { shop_id: shopId } },
  );
  return data;
}

export async function syncRetailerItemPrices(
  retailerId: UUID,
  shopId: UUID,
  items: RetailerItemPriceInput[],
) {
  const { data } = await apiClient.put<RetailerItemPriceRead[]>(
    `/api/v1/admin/retailers/${retailerId}/items`,
    { items },
    { params: { shop_id: shopId } },
  );
  return data;
}

export async function fetchRetailerItemAllocations(
  retailerId: UUID,
  shopId: UUID,
  params?: {
    q?: string;
    allocated?: "allocated" | "available";
    limit?: number;
    effective_date?: string;
  },
) {
  const { data } = await apiClient.get<RetailerItemAllocationListRead>(
    `/api/v1/admin/retailers/${retailerId}/item-allocations`,
    { params: { shop_id: shopId, ...params } },
  );
  return data;
}

export async function bulkAllocateRetailerItems(
  retailerId: UUID,
  shopId: UUID,
  items: RetailerItemPriceInput[],
) {
  const { data } = await apiClient.post<RetailerItemAllocationBulkRead>(
    `/api/v1/admin/retailers/${retailerId}/item-allocations`,
    { items },
    { params: { shop_id: shopId } },
  );
  return data;
}

export async function updateRetailerItemAllocation(
  retailerId: UUID,
  shopId: UUID,
  itemId: UUID,
  payload: RetailerItemAllocationUpdate,
) {
  const { data } = await apiClient.patch<RetailerItemPriceRead>(
    `/api/v1/admin/retailers/${retailerId}/item-allocations/${itemId}`,
    payload,
    { params: { shop_id: shopId } },
  );
  return data;
}

export async function deleteRetailerItemAllocation(
  retailerId: UUID,
  shopId: UUID,
  itemId: UUID,
) {
  await apiClient.delete(`/api/v1/admin/retailers/${retailerId}/item-allocations/${itemId}`, {
    params: { shop_id: shopId },
  });
}

export async function fetchRetailerBalance(retailerId: UUID) {
  const { data } = await apiClient.get<RetailerBalanceRead>(
    `/api/v1/admin/retailers/${retailerId}/balance`,
  );
  return data;
}

export async function recordRetailerWalletPayout(
  retailerId: UUID,
  payload: RetailerWalletPayoutCreate,
) {
  const { data } = await apiClient.post<RetailerWalletPayoutRead>(
    `/api/v1/admin/retailers/${retailerId}/wallet-payouts`,
    payload,
  );
  return data;
}

export async function fetchRetailerBranchAllocations(retailerId: UUID) {
  const { data } = await apiClient.get<RetailerBranchAllocationRead[]>(
    `/api/v1/admin/retailers/${retailerId}/branches`,
  );
  return data;
}

export async function syncRetailerBranchAllocations(retailerId: UUID, shopIds: UUID[]) {
  const { data } = await apiClient.put<RetailerBranchAllocationRead[]>(
    `/api/v1/admin/retailers/${retailerId}/branches`,
    { shop_ids: shopIds },
  );
  return data;
}

export async function fetchAdminRetailerSales(params?: {
  shop_id?: UUID;
  retailer_id?: UUID;
  status?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
  page_size?: number;
}) {
  const { data } = await apiClient.get<RetailerSalePage>("/api/v1/admin/retailer-sales", {
    params,
  });
  return data;
}

export async function fetchAllAdminRetailerSales(params?: {
  shop_id?: UUID;
  retailer_id?: UUID;
  status?: string;
  start_date?: string;
  end_date?: string;
}) {
  const pageSize = 100;
  let page = 1;
  let items: RetailerSaleRead[] = [];
  let total = 0;

  do {
    const response = await fetchAdminRetailerSales({ ...params, page, page_size: pageSize });
    if (response.items.length === 0) {
      break;
    }
    items = items.concat(response.items);
    total = response.total;
    page += 1;
  } while (items.length < total);

  return items;
}

export async function fetchAdminRetailerSale(saleId: UUID) {
  const { data } = await apiClient.get<RetailerSaleRead>(
    `/api/v1/admin/retailer-sales/${saleId}`,
  );
  return data;
}

export async function editAdminRetailerSale(saleId: UUID, payload: RetailerSaleEditRequest) {
  const { data } = await apiClient.patch<RetailerSaleRead>(
    `/api/v1/admin/retailer-sales/${saleId}`,
    payload,
  );
  return data;
}

export async function cancelAdminRetailerSale(saleId: UUID) {
  const { data } = await apiClient.post<RetailerSaleRead>(
    `/api/v1/admin/retailer-sales/${saleId}/cancel`,
  );
  return data;
}

export async function recordAdminRetailerPayment(saleId: UUID, payload: RetailerPaymentCreate) {
  const { data } = await apiClient.post<RetailerPaymentRecordResponse>(
    `/api/v1/admin/retailer-sales/${saleId}/payments`,
    payload,
  );
  return data;
}

export async function fetchAdminRetailerSaleReceipts(
  saleId: UUID,
  params?: { page?: number; page_size?: number },
) {
  const { data } = await apiClient.get<RetailerSaleReceiptPage>(
    `/api/v1/admin/retailer-sales/${saleId}/receipts`,
    { params },
  );
  return data;
}

export async function fetchShopRetailers(q?: string) {
  const { data } = await apiClient.get<RetailerRead[]>("/api/v1/shop/retailers", {
    params: { q: q || undefined },
  });
  return data;
}
