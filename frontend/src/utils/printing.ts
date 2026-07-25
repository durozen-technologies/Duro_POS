import { useAuthStore } from "@/store/auth-store";

/** Whether the current org requires thermal printing for billing flows. */
export function usePrintingEnabled(): boolean {
  return useAuthStore((state) => state.user?.printing_enabled !== false);
}
