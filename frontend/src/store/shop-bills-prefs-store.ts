import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { SHOP_BILLS_PAGE_SIZE_STORAGE_KEY } from "@/constants/config";
import { secureStorage } from "@/utils/secure-storage";

/** Allowed page sizes for shop bills list (must stay within API le=100). */
export const SHOP_BILLS_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
export type ShopBillsPageSize = (typeof SHOP_BILLS_PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_SHOP_BILLS_PAGE_SIZE: ShopBillsPageSize = 10;

function sanitizePageSize(value: unknown): ShopBillsPageSize {
  const numeric = typeof value === "number" ? value : Number(value);
  if ((SHOP_BILLS_PAGE_SIZE_OPTIONS as readonly number[]).includes(numeric)) {
    return numeric as ShopBillsPageSize;
  }
  return DEFAULT_SHOP_BILLS_PAGE_SIZE;
}

type ShopBillsPrefsState = {
  pageSize: ShopBillsPageSize;
  setPageSize: (pageSize: ShopBillsPageSize) => void;
};

export const useShopBillsPrefsStore = create<ShopBillsPrefsState>()(
  persist(
    (set) => ({
      pageSize: DEFAULT_SHOP_BILLS_PAGE_SIZE,
      setPageSize: (pageSize) => set({ pageSize: sanitizePageSize(pageSize) }),
    }),
    {
      name: SHOP_BILLS_PAGE_SIZE_STORAGE_KEY,
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({ pageSize: state.pageSize }),
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<Pick<ShopBillsPrefsState, "pageSize">>;
        return { pageSize: sanitizePageSize(state.pageSize) };
      },
    },
  ),
);
