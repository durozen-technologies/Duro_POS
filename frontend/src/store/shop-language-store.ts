import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { SHOP_LANGUAGE_STORAGE_KEY } from "@/constants/config";
import { secureStorage } from "@/utils/secure-storage";

export type ShopLanguage = "en" | "ta";

type ShopLanguageState = {
  language: ShopLanguage;
  setLanguage: (language: ShopLanguage) => void;
  toggleLanguage: () => void;
};

export const useShopLanguageStore = create<ShopLanguageState>()(
  persist(
    (set) => ({
      language: "en",
      setLanguage: (language) => set({ language }),
      toggleLanguage: () =>
        set((state) => ({
          language: state.language === "en" ? "ta" : "en",
        })),
    }),
    {
      name: SHOP_LANGUAGE_STORAGE_KEY,
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({ language: state.language }),
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<Pick<ShopLanguageState, "language">>;
        return { language: state.language === "ta" ? "ta" : "en" };
      },
    },
  ),
);
