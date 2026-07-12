import { apiClient } from "@/api/client";
import {
  RetailerSaleStatus,
  type RetailerCatalogItemRead,
  type RetailerPaymentCreate,
  type RetailerPaymentRecordResponse,
  type RetailerSaleCheckoutCommitRequest,
  type RetailerSaleCheckoutRequest,
  type RetailerSalePage,
  type RetailerSalePreviewRead,
  type RetailerSaleRead,
  type RetailerSaleReceiptPage,
  type RetailerSaleReceiptRead,
  type RetailerWalletRead,
  type UUID,
} from "@/types/api";

export async function fetchRetailerCatalog(retailerId: UUID) {
  const { data } = await apiClient.get<RetailerCatalogItemRead[]>(
    `/api/v1/shop/retailers/${retailerId}/catalog`,
  );
  return data;
}

export async function fetchShopRetailerWallet(retailerId: UUID) {
  const { data } = await apiClient.get<RetailerWalletRead>(
    `/api/v1/shop/retailers/${retailerId}/wallet`,
  );
  return data;
}

export async function previewRetailerSale(payload: RetailerSaleCheckoutRequest) {
  const { data } = await apiClient.post<RetailerSalePreviewRead>(
    "/api/v1/shop/retailer-sales/preview",
    payload,
  );
  return data;
}

export async function commitRetailerSale(payload: RetailerSaleCheckoutCommitRequest) {
  const { data } = await apiClient.post<RetailerSaleRead>("/api/v1/shop/retailer-sales", payload);
  return data;
}

export async function recordShopRetailerPayment(saleId: UUID, payload: RetailerPaymentCreate) {
  const { data } = await apiClient.post<RetailerPaymentRecordResponse>(
    `/api/v1/shop/retailer-sales/${saleId}/payments`,
    payload,
  );
  return data;
}

export async function fetchShopRetailerSales(params?: {
  retailer_id?: UUID;
  page?: number;
  page_size?: number;
}) {
  const { data } = await apiClient.get<RetailerSalePage>("/api/v1/shop/retailer-sales", {
    params,
  });
  return data;
}

export async function fetchAllShopRetailerSales() {
  const pageSize = 100;
  let page = 1;
  let items: RetailerSaleRead[] = [];
  let total = 0;

  do {
    const response = await fetchShopRetailerSales({ page, page_size: pageSize });
    if (response.items.length === 0) {
      break;
    }
    items = items.concat(response.items);
    total = response.total;
    page += 1;
  } while (items.length < total);

  return items;
}

export async function fetchShopRetailerOutstandingBalance(retailerId: UUID): Promise<string> {
  const pageSize = 100;
  let page = 1;
  let total = 0;
  let outstanding = 0;

  do {
    const response = await fetchShopRetailerSales({
      retailer_id: retailerId,
      page,
      page_size: pageSize,
    });
    if (response.items.length === 0) {
      break;
    }
    for (const sale of response.items) {
      if (
        sale.status === RetailerSaleStatus.OPEN ||
        sale.status === RetailerSaleStatus.PARTIAL
      ) {
        outstanding += Number(sale.balance_due);
      }
    }
    total = response.total;
    page += 1;
  } while ((page - 1) * pageSize < total);

  return outstanding.toFixed(2);
}

export async function fetchShopRetailerSale(saleId: UUID) {
  const { data } = await apiClient.get<RetailerSaleRead>(
    `/api/v1/shop/retailer-sales/${saleId}`,
  );
  return data;
}

export async function fetchShopRetailerSaleReceipts(
  saleId: UUID,
  params?: { page?: number; page_size?: number },
) {
  const { data } = await apiClient.get<RetailerSaleReceiptPage>(
    `/api/v1/shop/retailer-sales/${saleId}/receipts`,
    { params },
  );
  return data;
}

export async function fetchShopRetailerSaleReceipt(saleId: UUID, receiptId: UUID) {
  const { data } = await apiClient.get<RetailerSaleReceiptRead>(
    `/api/v1/shop/retailer-sales/${saleId}/receipts/${receiptId}`,
  );
  return data;
}
