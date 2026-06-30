import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { AUTH_STORAGE_KEY } from "@/constants/config";
import { UserSession } from "@/types/api";
import { secureStorage } from "@/utils/secure-storage";

type AuthState = {
  token: string | null;
  user: UserSession | null;
  hydrated: boolean;
  setSession: (token: string, user: UserSession) => void;
  setHydrated: (value: boolean) => void;
  clearSession: () => void;
};

export function userHasPermission(
  user: { permissions?: string[] } | null | undefined,
  code: string,
): boolean {
  const permissions = user?.permissions;
  if (!permissions?.length) return false;
  if (permissions.includes("*")) return true;
  return permissions.includes(code);
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      hydrated: false,
      setSession: (token, user) => set({ token, user }),
      setHydrated: (hydrated) => set({ hydrated }),
      clearSession: () =>
        set((state) =>
          state.token === null && state.user === null
            ? state
            : { token: null, user: null },
        ),
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({ token: state.token, user: state.user }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);
