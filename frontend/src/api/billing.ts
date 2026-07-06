import { apiClient } from "@/api/client";
import {
  BillCheckoutCommitRequest,
  BillCheckoutPreviewRead,
  BillCheckoutRequest,
  BillRead,
  BillReceiptStatusUpdate,
  ShopBillListParams,
  ShopBillPage,
} from "@/types/api";

export async function previewBill(payload: BillCheckoutRequest) {
  const { data } = await apiClient.post<BillCheckoutPreviewRead>(
    "/api/v1/shop/bills/preview",
    payload,
  );
  return data;
}

export type CheckoutBillResult = {
  bill: BillRead;
  created: boolean;
};

export async function checkoutBill(payload: BillCheckoutCommitRequest): Promise<CheckoutBillResult> {
  const response = await apiClient.post<BillRead>("/api/v1/shop/bills", payload);
  return {
    bill: response.data,
    created: response.status === 201,
  };
}

export async function fetchShopBills(params: ShopBillListParams = {}) {
  const { data } = await apiClient.get<ShopBillPage>("/api/v1/shop/bills", { params });
  return data;
}

export async function fetchShopBill(billId: string) {
  const { data } = await apiClient.get<BillRead>(`/api/v1/shop/bills/${billId}`);
  return data;
}

export async function patchBillReceiptStatus(billId: string, payload: BillReceiptStatusUpdate) {
  const { data } = await apiClient.patch<BillRead>(
    `/api/v1/shop/bills/${billId}/receipt`,
    payload,
  );
  return data;
}

export async function reprintShopBill(billId: string) {
  const { data } = await apiClient.post<BillRead>(`/api/v1/shop/bills/${billId}/reprint`);
  return data;
}
