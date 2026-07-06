import { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApiConnection } from "@/hooks/use-api-connection";

import { ApiConnectionBanner } from "./api-connection-banner";

type ApiConnectionProviderProps = {
  children: ReactNode;
};

/** Global offline banner — one place for all routes; no per-screen duplication. */
export function ApiConnectionProvider({ children }: ApiConnectionProviderProps) {
  const insets = useSafeAreaInsets();
  const { status } = useApiConnection();
  const showBanner = status === "offline";

  return (
    <View style={styles.root}>
      {children}
      {showBanner ? (
        <View
          pointerEvents="box-none"
          style={[styles.bannerHost, { top: insets.top + 8, paddingHorizontal: 12 }]}
        >
          <ApiConnectionBanner />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  bannerHost: {
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 1000,
  },
});
