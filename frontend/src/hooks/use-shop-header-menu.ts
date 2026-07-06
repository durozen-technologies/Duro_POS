import { useCallback, useMemo } from "react";
import type { NavigationProp } from "@react-navigation/native";

import { useAuthStore } from "@/store/auth-store";
import { useCartStore } from "@/store/cart-store";
import { usePriceStore } from "@/store/price-store";

type ShopStackNav = NavigationProp<Record<string, object | undefined>>;

type ShopHeaderMenuOptions = {
  onRefresh?: () => void;
  refreshing?: boolean;
};

export function useShopHeaderMenu(navigation: ShopStackNav, options?: ShopHeaderMenuOptions) {
  const clearSession = useAuthStore((s) => s.clearSession);
  const resetCart = useCartStore((s) => s.resetCart);
  const clearPrices = usePriceStore((s) => s.clear);

  const onLogout = useCallback(() => {
    clearSession();
    resetCart();
    clearPrices();
  }, [clearPrices, clearSession, resetCart]);

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
