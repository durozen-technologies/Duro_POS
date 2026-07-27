import { useAuthStore } from "@/store/auth-store";
import {
  DEFAULT_RECEIPT_PAPER_MM,
  normalizeReceiptPaperMm,
  type ReceiptPaperMm,
} from "@/utils/receipt-paper";

/** Whether the current org requires thermal printing for billing flows. */
export function usePrintingEnabled(): boolean {
  return useAuthStore((state) => state.user?.printing_enabled !== false);
}

/** Org receipt paper width in mm (58 or 80). Defaults to 58. */
export function useReceiptPaperMm(): ReceiptPaperMm {
  return useAuthStore((state) =>
    normalizeReceiptPaperMm(state.user?.receipt_paper_mm ?? DEFAULT_RECEIPT_PAPER_MM),
  );
}
