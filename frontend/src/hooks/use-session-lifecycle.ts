import { useEffect, useRef } from "react";
import { AppState, BackHandler, Platform, type AppStateStatus } from "react-native";

import { revalidateSessionOnForeground } from "@/auth/bootstrap-auth";
import { isAuthSessionReady, useAuthStore } from "@/store/auth-store";

/**
 * Keeps session fresh on foreground and blocks Android back from escaping auth stacks.
 */
export function useSessionLifecycle() {
  const token = useAuthStore((state) => state.token);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const wasBackground = appStateRef.current.match(/inactive|background/);
      appStateRef.current = nextState;
      if (wasBackground && nextState === "active" && token) {
        void revalidateSessionOnForeground();
      }
    });
    return () => subscription.remove();
  }, [token]);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!isAuthSessionReady()) {
        return true;
      }
      if (!token) {
        BackHandler.exitApp();
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [token]);
}
