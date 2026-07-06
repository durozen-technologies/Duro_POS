import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { ADMIN_ITEMS_STORAGE_KEY } from "@/constants/config";
import type { UUID } from "@/types/api";
import { secureStorage } from "@/utils/secure-storage";

type AdminItemsState = {
  selectedShopId: UUID | null;
  hydrated: boolean;
  setSelectedShopId: (selectedShopId: UUID | null) => void;
  setHydrated: (hydrated: boolean) => void;
};

export const useAdminItemsStore = create<AdminItemsState>()(
  persist(
    (set) => ({
      selectedShopId: null,
      hydrated: false,
      setSelectedShopId: (selectedShopId) => set({ selectedShopId }),
      setHydrated: (hydrated) => set({ hydrated }),
    }),
    {
      name: ADMIN_ITEMS_STORAGE_KEY,
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({ selectedShopId: state.selectedShopId }),
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<Pick<AdminItemsState, "selectedShopId">>;
        return { selectedShopId: state.selectedShopId ?? null };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);
