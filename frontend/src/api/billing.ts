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

const RECEIPT_STATUS_VALUES = new Set(["pending", "printed", "failed"]);
const PAYMENT_METHOD_VALUES = new Set(["cash", "upi", "mixed"]);

/** Build query params: omit empty/invalid values so filters never leak bad enums. */
export function buildShopBillListParams(params: ShopBillListParams = {}): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  if (params.page != null) query.page = params.page;
  if (params.page_size != null) query.page_size = params.page_size;
  const billNo = params.bill_no?.trim();
  if (billNo) query.bill_no = billNo;
  if (params.range_start_date) query.range_start_date = params.range_start_date;
  if (params.range_end_date) query.range_end_date = params.range_end_date;
  if (params.payment_method && PAYMENT_METHOD_VALUES.has(params.payment_method)) {
    query.payment_method = params.payment_method;
  }
  if (params.payment_settled != null) query.payment_settled = String(params.payment_settled);
  if (params.receipt_status && RECEIPT_STATUS_VALUES.has(params.receipt_status)) {
    query.receipt_status = params.receipt_status;
  }
  if (params.created_by_user_id) query.created_by_user_id = params.created_by_user_id;
  if (params.amount_min) query.amount_min = params.amount_min;
  if (params.amount_max) query.amount_max = params.amount_max;
  if (params.sort_by) query.sort_by = params.sort_by;
  if (params.sort_dir) query.sort_dir = params.sort_dir;
  return query;
}

export async function fetchShopBills(params: ShopBillListParams = {}) {
  const { data } = await apiClient.get<ShopBillPage>("/api/v1/shop/bills", {
    params: buildShopBillListParams(params),
  });
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
