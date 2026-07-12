import { BillStatus, type AdminBillSummary, type BillRead } from "@/types/api";

export const ADMIN_BILL_MODIFICATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isSaleWithinAdminModificationWindow(createdAt: string, now = Date.now()) {
  return now - new Date(createdAt).getTime() < ADMIN_BILL_MODIFICATION_WINDOW_MS;
}

export function isCancelledShopBill(bill: Pick<AdminBillSummary | BillRead, "status">) {
  return bill.status === BillStatus.CANCELLED;
}

export function canAdminModifyShopBill(
  bill: Pick<AdminBillSummary | BillRead, "status" | "created_at">,
) {
  if (isCancelledShopBill(bill)) {
    return false;
  }
  return isSaleWithinAdminModificationWindow(bill.created_at);
}

export function isApiConflictError(error: unknown) {
  if (typeof error === "object" && error !== null && "status" in error) {
    return (error as { status?: unknown }).status === 409;
  }
  return false;
}
