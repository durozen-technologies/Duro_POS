import { useCallback, useEffect } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { ShopHeaderActions, ShopHeaderTitle } from "@/components/shop-header";
import { LoadingState } from "@/components/ui/loading-state";
import { useAuthHydration } from "@/hooks/use-auth-hydration";
import { AppStackParamList } from "@/navigation/types";
import { useAuthStore } from "@/store/auth-store";
import { useCartStore } from "@/store/cart-store";
import { usePriceStore } from "@/store/price-store";

const Stack = createNativeStackNavigator<AppStackParamList>();

const screenOptions = {
  headerShadowVisible: false,
  headerStyle: { backgroundColor: "#F7F1E8" },
  headerTitleStyle: { color: "#1E2B22", fontWeight: "700" as const },
  contentStyle: { backgroundColor: "#F7F1E8" },
};

const getLoginScreen = () => require("@/screens/auth/login-screen").LoginScreen;
const getAdminDashboardScreen = () => require("@/screens/admin/admin-dashboard-screen").AdminDashboardScreen;
const getBillingScreen = () => require("@/screens/shop/billing-screen").BillingScreen;
const getCheckoutScreen = () => require("@/screens/shop/checkout-screen").CheckoutScreen;
const getReceiptScreen = () => require("@/screens/shop/receipt-screen").ReceiptScreen;
const getPrinterSetupScreen = () => require("@/screens/shop/printer-setup-screen").PrinterSetupScreen;

function useSessionReset() {
  const clearSession = useAuthStore((state) => state.clearSession);
  const resetCart = useCartStore((state) => state.resetCart);
  const clearPrices = usePriceStore((state) => state.clear);

  return useCallback(() => {
    clearSession();
    resetCart();
    clearPrices();
  }, [clearPrices, clearSession, resetCart]);
}

export function AppNavigator() {
  const hydrated = useAuthHydration();
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const logout = useSessionReset();
  const renderBillingHeaderTitle = useCallback(() => <ShopHeaderTitle titleKey="header.billing" />, []);
  const renderCheckoutHeaderTitle = useCallback(() => <ShopHeaderTitle titleKey="header.checkout" />, []);
  const renderReceiptHeaderTitle = useCallback(() => <ShopHeaderTitle titleKey="header.receipt" />, []);
  const renderPrinterHeaderTitle = useCallback(() => <ShopHeaderTitle titleKey="header.printerSetup" />, []);
  const renderHeaderActions = useCallback(() => <ShopHeaderActions onLogout={logout} />, [logout]);

  useEffect(() => {
    if (!token || !user) {
      useCartStore.getState().resetCart();
      usePriceStore.getState().clear();
    }
  }, [token, user]);

  if (!hydrated) {
    return <LoadingState fullscreen label="Restoring secure session..." />;
  }

  if (!token || !user) {
    return (
      <Stack.Navigator initialRouteName="Login" screenOptions={screenOptions}>
        <Stack.Screen name="Login" getComponent={getLoginScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
    );
  }

  if (user.role === "admin") {
    return (
      <Stack.Navigator initialRouteName="AdminDashboard" screenOptions={screenOptions}>
        <Stack.Screen
          name="AdminDashboard"
          getComponent={getAdminDashboardScreen}
          options={{
            headerShown: false,
          }}
        />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator initialRouteName="Billing" screenOptions={screenOptions}>
      <Stack.Screen
        name="Billing"
        getComponent={getBillingScreen}
        options={{
          headerTitle: renderBillingHeaderTitle,
          headerRight: renderHeaderActions,
        }}
      />
      <Stack.Screen
        name="Checkout"
        getComponent={getCheckoutScreen}
        options={{
          headerTitle: renderCheckoutHeaderTitle,
          headerRight: renderHeaderActions,
        }}
      />
      <Stack.Screen
        name="Receipt"
        getComponent={getReceiptScreen}
        options={{
          headerTitle: renderReceiptHeaderTitle,
          headerRight: renderHeaderActions,
        }}
      />
      <Stack.Screen
        name="PrinterSetup"
        getComponent={getPrinterSetupScreen}
        options={{
          headerTitle: renderPrinterHeaderTitle,
          headerRight: renderHeaderActions,
        }}
      />
    </Stack.Navigator>
  );
}
