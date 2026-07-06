import { isAuthSessionReady, useAuthStore } from "@/store/auth-store";

/** True when bootstrap finished and any restored session finished validation. */
export function useAuthHydration() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const sessionChecked = useAuthStore((state) => state.sessionChecked);
  const token = useAuthStore((state) => state.token);
  return hydrated && (!token || sessionChecked);
}

export function useAuthSessionReady() {
  return useAuthStore(() => isAuthSessionReady());
}
