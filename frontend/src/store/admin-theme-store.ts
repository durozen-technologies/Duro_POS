import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { ADMIN_THEME_STORAGE_KEY } from "@/constants/config";
import { secureStorage } from "@/utils/secure-storage";

export type AdminThemePreference = "system" | "light" | "dark";

type AdminThemeState = {
  themePreference: AdminThemePreference;
  setThemePreference: (themePreference: AdminThemePreference) => void;
};

export const useAdminThemeStore = create<AdminThemeState>()(
  persist(
    (set) => ({
      themePreference: "system",
      setThemePreference: (themePreference) => set({ themePreference }),
    }),
    {
      name: ADMIN_THEME_STORAGE_KEY,
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({ themePreference: state.themePreference }),
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<Pick<AdminThemeState, "themePreference">>;
        const preference = state.themePreference;
        return {
          themePreference:
            preference === "light" || preference === "dark" ? preference : "system",
        };
      },
    },
  ),
);
