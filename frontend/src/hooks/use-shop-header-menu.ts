import { useCallback, useMemo } from "react";
import type { NavigationProp } from "@react-navigation/native";

import { logout } from "@/store/auth-store";

type ShopStackNav = NavigationProp<Record<string, object | undefined>>;

type ShopHeaderMenuOptions = {
  onRefresh?: () => void;
  refreshing?: boolean;
};

export function useShopHeaderMenu(navigation: ShopStackNav, options?: ShopHeaderMenuOptions) {
  const onLogout = useCallback(() => {
    void logout();
  }, []);

  const onInventory = useCallback(() => {
    navigation.navigate("InventoryManagement");
  }, [navigation]);

  const onExpenses = useCallback(() => {
    navigation.navigate("ShopExpenses");
  }, [navigation]);

  const onPrinter = useCallback(() => {
    navigation.navigate("PrinterSetup");
  }, [navigation]);

  const onRetailers = useCallback(() => {
    navigation.navigate("RetailerSelect");
  }, [navigation]);

  const onBills = useCallback(() => {
    navigation.navigate("ShopBills");
  }, [navigation]);

  return useMemo(
    () => ({
      onLogout,
      onInventory,
      onExpenses,
      onPrinter,
      onRetailers,
      onBills,
      onRefresh: options?.onRefresh,
      refreshing: options?.refreshing ?? false,
    }),
    [
      onLogout,
      onInventory,
      onExpenses,
      onPrinter,
      onRetailers,
      onBills,
      options?.onRefresh,
      options?.refreshing,
    ],
  );
}
