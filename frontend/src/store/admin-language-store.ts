import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { ADMIN_LANGUAGE_STORAGE_KEY } from "@/constants/config";
import { secureStorage } from "@/utils/secure-storage";

export type AdminLanguage = "en" | "ta";

type AdminLanguageState = {
  language: AdminLanguage;
  setLanguage: (language: AdminLanguage) => void;
  toggleLanguage: () => void;
};

export const useAdminLanguageStore = create<AdminLanguageState>()(
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
      name: ADMIN_LANGUAGE_STORAGE_KEY,
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({ language: state.language }),
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<Pick<AdminLanguageState, "language">>;
        return { language: state.language === "ta" ? "ta" : "en" };
      },
    },
  ),
);
