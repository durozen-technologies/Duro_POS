import { apiClient } from "@/api/client";
import type {
  RetailerBalanceRead,
  RetailerBranchAllocationRead,
  RetailerCreate,
  RetailerItemPriceInput,
  RetailerItemPriceRead,
  RetailerPage,
  RetailerPaymentCreate,
  RetailerPaymentRecordResponse,
  RetailerRead,
  RetailerSalePage,
  RetailerSaleRead,
  RetailerSaleReceiptPage,
  RetailerSaleReceiptRead,
  RetailerUpdate,
  UUID,
} from "@/types/api";

export async function fetchRetailers(params?: {
  q?: string;
  active?: boolean;
  page?: number;
  page_size?: number;
}) {
  const { data } = await apiClient.get<RetailerPage>("/api/v1/admin/retailers", { params });
  return data;
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

export async function fetchRetailerItemPrices(retailerId: UUID) {
  const { data } = await apiClient.get<RetailerItemPriceRead[]>(
    `/api/v1/admin/retailers/${retailerId}/items`,
  );
  return data;
}

export async function syncRetailerItemPrices(
  retailerId: UUID,
  items: RetailerItemPriceInput[],
) {
  const { data } = await apiClient.put<RetailerItemPriceRead[]>(
    `/api/v1/admin/retailers/${retailerId}/items`,
    { items },
  );
  return data;
}

export async function fetchRetailerBalance(retailerId: UUID) {
  const { data } = await apiClient.get<RetailerBalanceRead>(
    `/api/v1/admin/retailers/${retailerId}/balance`,
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
