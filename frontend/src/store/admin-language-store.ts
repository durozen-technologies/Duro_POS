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

/** Ignore late SecureStore rehydrate if user already picked a language. */
let languageTouchedDuringHydration = false;

function normalizeLanguage(value: unknown): AdminLanguage {
  return value === "ta" ? "ta" : "en";
}

export const useAdminLanguageStore = create<AdminLanguageState>()(
  persist(
    (set) => ({
      language: "en",
      setLanguage: (language) => {
        languageTouchedDuringHydration = true;
        set({ language: normalizeLanguage(language) });
      },
      toggleLanguage: () => {
        languageTouchedDuringHydration = true;
        set((state) => ({
          language: state.language === "en" ? "ta" : "en",
        }));
      },
    }),
    {
      name: ADMIN_LANGUAGE_STORAGE_KEY,
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({ language: state.language }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<Pick<AdminLanguageState, "language">>;
        if (languageTouchedDuringHydration) {
          return currentState;
        }
        return {
          ...currentState,
          language: normalizeLanguage(persisted.language),
        };
      },
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<Pick<AdminLanguageState, "language">>;
        return { language: normalizeLanguage(state.language) };
      },
    },
  ),
);
