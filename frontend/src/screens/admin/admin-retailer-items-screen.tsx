import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

import type { AdminRetailerItemsScreenProps } from "@/navigation/types";

import { useAdminTheme } from "./use-admin-theme";

/** @deprecated Use AdminRetailers tab allocateItems instead. */
export function AdminRetailerItemsScreen({ navigation, route }: AdminRetailerItemsScreenProps) {
  const { retailerId } = route.params;
  const { palette } = useAdminTheme();

  useEffect(() => {
    navigation.replace("AdminRetailers", {
      tab: "allocateItems",
      retailerId,
    });
  }, [navigation, retailerId]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.background }}>
      <ActivityIndicator color={palette.primary} />
    </View>
  );
}
