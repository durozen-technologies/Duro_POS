import React, { useCallback, useEffect, useRef } from "react";
import {
  View,
  Animated,
  StyleSheet,
  StatusBar,
  Platform,
  Easing,
  Image,
  Text,
} from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { ShopHeaderActions, ShopHeaderTitle } from "@/components/shop-header";
import { appTheme } from "@/constants/theme";
import { useAuthHydration } from "@/hooks/use-auth-hydration";
import { useShopBootstrap } from "@/hooks/use-shop-bootstrap";
import { ShopTranslationKey } from "@/hooks/use-shop-translation";
import { AppStackParamList } from "@/navigation/types";
import { useAuthStore } from "@/store/auth-store";
import { useCartStore } from "@/store/cart-store";
import { usePriceStore } from "@/store/price-store";
import { UserRole } from "@/types/api";

const Stack = createNativeStackNavigator<AppStackParamList>();
const LOGO_IMAGE = require("../../assets/Logo.png");

// ── Design Tokens (extracted from your existing #F7F1E8) ─────────────
const COLORS = {
  background: appTheme.background,
  textPrimary: appTheme.text,
  textSecondary: appTheme.muted,
  accent: appTheme.accent,
  accentLight: appTheme.accentSoft,
  border: appTheme.border,
  danger: appTheme.danger,
  white: appTheme.card,
  overlay: "rgba(30, 43, 34, 0.4)",
} as const;

// ── Existing screen options, enhanced ────────────────────────────────
const screenOptions = {
  headerShadowVisible: false,
  headerStyle: { backgroundColor: COLORS.background },
  headerTitleStyle: { color: COLORS.textPrimary, fontWeight: "700" as const },
  contentStyle: { backgroundColor: COLORS.background },
};
const HEADER_HIDDEN_OPTIONS = { headerShown: false } as const;
const AUTH_STACK_SCREEN_OPTIONS = {
  ...screenOptions,
  animation: "fade" as const,
  animationDuration: 350,
};
const ADMIN_STACK_SCREEN_OPTIONS = {
  ...screenOptions,
  animation: "slide_from_right" as const,
  animationDuration: 250,
};
const SHOP_STACK_SCREEN_OPTIONS = {
  ...screenOptions,
  animation: "slide_from_right" as const,
  animationDuration: 250,
  gestureEnabled: true,
  fullScreenGestureEnabled: true,
};

// ── Lazy loaders (unchanged) ─────────────────────────────────────────
const getLoginScreen = () => require("@/screens/auth/login-screen").LoginScreen;
const getSuperAdminDashboardScreen = () =>
  require("@/screens/super-admin/super-admin-dashboard-screen")
    .SuperAdminDashboardScreen;
const getSuperAdminOrgsScreen = () =>
  require("@/screens/super-admin/super-admin-orgs-screen").SuperAdminOrgsScreen;
const getSuperAdminAdminsScreen = () =>
  require("@/screens/super-admin/super-admin-admins-screen")
    .SuperAdminAdminsScreen;
const getSuperAdminAuditScreen = () =>
  require("@/screens/super-admin/super-admin-audit-screen")
    .SuperAdminAuditScreen;
const getAdminDashboardScreen = () =>
  require("@/screens/admin/admin-dashboard-screen").AdminDashboardScreen;
const getAdminItemsCatalogueScreen = () =>
  require("@/screens/admin/admin-items-route-screen").AdminItemsCatalogueScreen;
const getAdminItemAssumptionScreen = () =>
  require("@/screens/admin/admin-items-route-screen").AdminItemAssumptionScreen;
const getAdminShopItemsScreen = () =>
  require("@/screens/admin/admin-items-route-screen").AdminShopItemsScreen;
const getAdminShopItemsOrderScreen = () =>
  require("@/screens/admin/admin-shop-items-order-screen")
    .AdminShopItemsOrderScreen;
const getAdminItemPricesScreen = () =>
  require("@/screens/admin/admin-items-route-screen").AdminItemPricesScreen;
const getAdminItemCategoriesScreen = () =>
  require("@/screens/admin/admin-item-categories-screen")
    .AdminItemCategoriesScreen;
const getAdminInventoryScreen = () =>
  require("@/screens/admin/admin-inventory-screen").AdminInventoryScreen;
const getAdminReportsScreen = () =>
  require("@/screens/admin/admin-reports-screen").AdminReportsScreen;
const getAdminOverallReportPreviewScreen = () =>
  require("@/screens/admin/admin-overall-report-preview-screen")
    .AdminOverallReportPreviewScreen;
const getAdminExpensesScreen = () =>
  require("@/screens/admin/admin-expenses-screen").AdminExpensesScreen;
const getAdminShopExpensesOrderScreen = () =>
  require("@/screens/admin/admin-shop-expenses-order-screen")
    .AdminShopExpensesOrderScreen;
const getAdminInventoryItemEditorScreen = () =>
  require("@/screens/admin/admin-inventory-item-editor-screen")
    .AdminInventoryItemEditorScreen;
const getAdminItemEditorScreen = () =>
  require("@/screens/admin/admin-item-editor-screen").AdminItemEditorScreen;
const getBillingScreen = () =>
  require("@/screens/shop/billing-screen").BillingScreen;
const getCheckoutScreen = () =>
  require("@/screens/shop/checkout-screen").CheckoutScreen;
const getInventoryManagementScreen = () =>
  require("@/screens/shop/inventory-management-screen")
    .InventoryManagementScreen;
const getShopExpensesScreen = () =>
  require("@/screens/shop/expenses-screen").ShopExpensesScreen;
const getPrinterSetupScreen = () =>
  require("@/screens/shop/printer-setup-screen").PrinterSetupScreen;

// ── Session reset hook (unchanged logic, memoized return) ────────────
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

// ── Animated Header Title (fade + slide in) ──────────────────────────
const AnimatedHeaderTitle = React.memo(function AnimatedHeaderTitle({
  titleKey,
  shopName,
}: {
  titleKey: ShopTranslationKey;
  shopName?: string | null;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-6)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <ShopHeaderTitle titleKey={titleKey} shopName={shopName} />
    </Animated.View>
  );
});

// ── Animated Header Actions (scale in) ───────────────────────────────
const AnimatedHeaderActions = React.memo(function AnimatedHeaderActions({
  onLogout,
}: {
  onLogout: () => void;
}) {
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 8,
      tension: 40,
      useNativeDriver: true,
    }).start();
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [scale, opacity]);

  return (
    <Animated.View style={{ opacity, transform: [{ scale }] }}>
      <ShopHeaderActions onLogout={onLogout} />
    </Animated.View>
  );
});

// ── App startup loading state ────────────────────────────────────────
function HydrationScreen({
  label = "Restoring secure session...",
}: {
  label?: string;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;
  const logoScale = useRef(new Animated.Value(0.94)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.spring(translateY, {
        toValue: 0,
        damping: 16,
        stiffness: 90,
        mass: 0.8,
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        damping: 14,
        stiffness: 80,
        mass: 0.8,
        useNativeDriver: true,
      }),
    ]).start();

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.cubic),
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.cubic),
        }),
      ]),
    );
    const rotateLoop = Animated.loop(
      Animated.timing(rotate, {
        toValue: 1,
        duration: 1600,
        useNativeDriver: true,
        easing: Easing.linear,
      }),
    );

    pulseLoop.start();
    rotateLoop.start();

    return () => {
      pulseLoop.stop();
      rotateLoop.stop();
    };
  }, [fadeAnim, logoScale, pulse, rotate, translateY]);

  const ringRotation = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1.08],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.32, 0.55, 0.32],
  });

  return (
    <View style={styles.hydrationContainer}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      <Animated.View
        style={[
          styles.loadingWrapper,
          {
            opacity: fadeAnim,
            transform: [{ translateY }, { scale: logoScale }],
          },
        ]}
      >
        <View style={styles.logoStage}>
          <Animated.View
            style={[
              styles.logoPulseRing,
              {
                opacity: pulseOpacity,
                transform: [{ scale: pulseScale }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.logoRing,
              {
                transform: [{ rotate: ringRotation }],
              },
            ]}
          />
          <View style={styles.logoTile}>
            <Image
              source={LOGO_IMAGE}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
        </View>

        <Text style={styles.loadingTitle}>SMB Billing</Text>
        <Text style={styles.loadingLabel}>{label}</Text>
      </Animated.View>
    </View>
  );
}

// ── Auth Stack (login only) ──────────────────────────────────────────
function AuthStack() {
  return (
    <Stack.Navigator
      initialRouteName="Login"
      screenOptions={AUTH_STACK_SCREEN_OPTIONS}
    >
      <Stack.Screen
        name="Login"
        getComponent={getLoginScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
    </Stack.Navigator>
  );
}

// ── Super Admin Stack ────────────────────────────────────────────────
function SuperAdminStack() {
  return (
    <Stack.Navigator
      initialRouteName="SuperAdminDashboard"
      screenOptions={ADMIN_STACK_SCREEN_OPTIONS}
    >
      <Stack.Screen
        name="SuperAdminDashboard"
        getComponent={getSuperAdminDashboardScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="SuperAdminOrgs"
        getComponent={getSuperAdminOrgsScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="SuperAdminAdmins"
        getComponent={getSuperAdminAdminsScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="SuperAdminAudit"
        getComponent={getSuperAdminAuditScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
    </Stack.Navigator>
  );
}

// ── Admin Stack ──────────────────────────────────────────────────────
function AdminStack() {
  return (
    <Stack.Navigator
      initialRouteName="AdminDashboard"
      screenOptions={ADMIN_STACK_SCREEN_OPTIONS}
    >
      <Stack.Screen
        name="AdminDashboard"
        getComponent={getAdminDashboardScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="AdminItemsCatalogue"
        getComponent={getAdminItemsCatalogueScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="AdminItemAssumption"
        getComponent={getAdminItemAssumptionScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="AdminShopItems"
        getComponent={getAdminShopItemsScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="AdminShopItemsOrder"
        getComponent={getAdminShopItemsOrderScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="AdminItemPrices"
        getComponent={getAdminItemPricesScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="AdminItemCategories"
        getComponent={getAdminItemCategoriesScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="AdminInventory"
        getComponent={getAdminInventoryScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="AdminReports"
        getComponent={getAdminReportsScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="AdminOverallReportPreview"
        getComponent={getAdminOverallReportPreviewScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="AdminExpenses"
        getComponent={getAdminExpensesScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="AdminShopExpensesOrder"
        getComponent={getAdminShopExpensesOrderScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="AdminInventoryItemEditor"
        getComponent={getAdminInventoryItemEditorScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
      <Stack.Screen
        name="AdminItemEditor"
        getComponent={getAdminItemEditorScreen}
        options={HEADER_HIDDEN_OPTIONS}
      />
    </Stack.Navigator>
  );
}

// ── Shop Stack (billing, checkout, printer) ──────────────────────────
function ShopStack() {
  const logout = useSessionReset();
  const { bootstrap } = useShopBootstrap();
  const shopName = bootstrap?.shop_name ?? null;

  // Memoized renderers to prevent unnecessary re-renders
  const renderBillingHeaderTitle = useCallback(
    () => <AnimatedHeaderTitle titleKey="header.billing" shopName={shopName} />,
    [shopName],
  );
  const renderCheckoutHeaderTitle = useCallback(
    () => (
      <AnimatedHeaderTitle titleKey="header.checkout" shopName={shopName} />
    ),
    [shopName],
  );
  const renderPrinterHeaderTitle = useCallback(
    () => (
      <AnimatedHeaderTitle titleKey="header.printerSetup" shopName={shopName} />
    ),
    [shopName],
  );
  const renderInventoryHeaderTitle = useCallback(
    () => (
      <AnimatedHeaderTitle titleKey="header.inventory" shopName={shopName} />
    ),
    [shopName],
  );
  const renderExpensesHeaderTitle = useCallback(
    () => (
      <AnimatedHeaderTitle titleKey="header.expenses" shopName={shopName} />
    ),
    [shopName],
  );
  const renderHeaderActions = useCallback(
    () => <AnimatedHeaderActions onLogout={logout} />,
    [logout],
  );

  return (
    <Stack.Navigator
      initialRouteName="Billing"
      screenOptions={SHOP_STACK_SCREEN_OPTIONS}
    >
      <Stack.Screen
        name="Billing"
        getComponent={getBillingScreen}
        options={{
          headerTitle: renderBillingHeaderTitle,
          headerRight: renderHeaderActions,
          // Billing is home — no back button
          headerBackVisible: false,
        }}
      />
      <Stack.Screen
        name="Checkout"
        getComponent={getCheckoutScreen}
        options={{
          headerTitle: renderCheckoutHeaderTitle,
          headerRight: renderHeaderActions,
          // Modal feel for checkout flow
          presentation: Platform.OS === "ios" ? "modal" : "card",
          animation: Platform.OS === "ios" ? "default" : "slide_from_bottom",
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
      <Stack.Screen
        name="InventoryManagement"
        getComponent={getInventoryManagementScreen}
        options={{
          headerTitle: renderInventoryHeaderTitle,
          headerRight: renderHeaderActions,
        }}
      />
      <Stack.Screen
        name="ShopExpenses"
        getComponent={getShopExpensesScreen}
        options={{
          headerTitle: renderExpensesHeaderTitle,
          headerRight: renderHeaderActions,
        }}
      />
    </Stack.Navigator>
  );
}

// ── Main App Navigator (preserves all original logic) ────────────────
export function AppNavigator() {
  const hydrated = useAuthHydration();
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  // Original effect: clear cart/prices when logged out
  useEffect(() => {
    if (!token || !user) {
      useCartStore.getState().resetCart();
      usePriceStore.getState().clear();
    }
  }, [token, user]);

  // Early return: auth loading
  if (!hydrated) {
    return <HydrationScreen />;
  }

  // Early return: not authenticated
  if (!token || !user) {
    return <AuthStack />;
  }

  // Super Admin route
  if (user.role === UserRole.SUPER_ADMIN) {
    return <SuperAdminStack />;
  }

  // Admin route (tenant admin + legacy admin alias)
  if (user.role === UserRole.TENANT_ADMIN) {
    return <AdminStack />;
  }

  // Shop route (default)
  return <ShopStack />;
}

// ── Styles ───────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  hydrationContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
  },
  loadingWrapper: {
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
  },
  logoStage: {
    width: 206,
    height: 206,
    alignItems: "center",
    justifyContent: "center",
  },
  logoPulseRing: {
    position: "absolute",
    width: 188,
    height: 188,
    borderRadius: 94,
    borderWidth: 1,
    borderColor: "rgba(255, 48, 48, 0.32)",
  },
  logoRing: {
    position: "absolute",
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 2,
    borderColor: "rgba(36, 71, 52, 0.12)",
    borderTopColor: "#FF3030",
    borderRightColor: "#FF3030",
  },
  logoTile: {
    width: 154,
    height: 154,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 8,
  },
  logoImage: {
    width: 218,
    height: 218,
  },
  loadingTitle: {
    marginTop: 18,
    color: COLORS.textPrimary,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0,
  },
  loadingLabel: {
    marginTop: 8,
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0,
  },
});
