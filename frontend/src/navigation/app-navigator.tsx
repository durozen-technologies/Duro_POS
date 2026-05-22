import React, { useCallback, useEffect, useRef } from "react";
import {
  View,
  Animated,
  StyleSheet,
  StatusBar,
  Platform,
  Easing,
} from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { ShopHeaderActions, ShopHeaderTitle } from "@/components/shop-header";
import { LoadingState } from "@/components/ui/loading-state";
import { useAuthHydration } from "@/hooks/use-auth-hydration";
import { ShopTranslationKey } from "@/hooks/use-shop-translation";
import { AppStackParamList } from "@/navigation/types";
import { useAuthStore } from "@/store/auth-store";
import { useCartStore } from "@/store/cart-store";
import { usePriceStore } from "@/store/price-store";

const Stack = createNativeStackNavigator<AppStackParamList>();

// ── Design Tokens (extracted from your existing #F7F1E8) ─────────────
const COLORS = {
  background: "#F7F1E8",
  textPrimary: "#1E2B22",
  textSecondary: "#5A6B5F",
  accent: "#2D5A3D",
  accentLight: "#E8F5E9",
  border: "#D4CFC5",
  danger: "#B71C1C",
  white: "#FFFFFF",
  overlay: "rgba(30, 43, 34, 0.4)",
} as const;

// ── Existing screen options, enhanced ────────────────────────────────
const screenOptions = {
  headerShadowVisible: false,
  headerStyle: { backgroundColor: COLORS.background },
  headerTitleStyle: { color: COLORS.textPrimary, fontWeight: "700" as const },
  contentStyle: { backgroundColor: COLORS.background },
};

// ── Lazy loaders (unchanged) ─────────────────────────────────────────
const getLoginScreen = () => require("@/screens/auth/login-screen").LoginScreen;
const getAdminDashboardScreen = () =>
  require("@/screens/admin/admin-dashboard-screen").AdminDashboardScreen;
const getBillingScreen = () =>
  require("@/screens/shop/billing-screen").BillingScreen;
const getCheckoutScreen = () =>
  require("@/screens/shop/checkout-screen").CheckoutScreen;
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
}: {
  titleKey: ShopTranslationKey;
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
      <ShopHeaderTitle titleKey={titleKey} />
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

// ── Enhanced Loading State with skeleton preview ─────────────────────
function HydrationScreen() {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const skeletonFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    // Staggered skeleton appearance
    Animated.timing(skeletonFade, {
      toValue: 1,
      duration: 400,
      delay: 200,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, skeletonFade]);

  return (
    <View style={styles.hydrationContainer}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor={COLORS.background}
      />
      <Animated.View style={[styles.loadingWrapper, { opacity: fadeAnim }]}>
        <LoadingState fullscreen label="Restoring secure session..." />
      </Animated.View>

      {/* Skeleton preview for perceived performance */}
      <Animated.View style={[styles.skeletonWrapper, { opacity: skeletonFade }]}>
        <View style={styles.skeletonHeader} />
        <View style={styles.skeletonCard} />
        <View style={styles.skeletonCard} />
        <View style={styles.skeletonRow}>
          <View style={[styles.skeletonButton, { flex: 2 }]} />
          <View style={[styles.skeletonButton, { flex: 1, marginLeft: 12 }]} />
        </View>
      </Animated.View>
    </View>
  );
}

// ── Auth Stack (login only) ──────────────────────────────────────────
function AuthStack() {
  return (
    <Stack.Navigator
      initialRouteName="Login"
      screenOptions={{
        ...screenOptions,
        animation: "fade",
        animationDuration: 350,
      }}
    >
      <Stack.Screen
        name="Login"
        getComponent={getLoginScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

// ── Admin Stack ──────────────────────────────────────────────────────
function AdminStack() {
  return (
    <Stack.Navigator
      initialRouteName="AdminDashboard"
      screenOptions={{
        ...screenOptions,
        animation: "slide_from_right",
        animationDuration: 250,
      }}
    >
      <Stack.Screen
        name="AdminDashboard"
        getComponent={getAdminDashboardScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

// ── Shop Stack (billing, checkout, printer) ──────────────────────────
function ShopStack() {
  const logout = useSessionReset();

  // Memoized renderers to prevent unnecessary re-renders
  const renderBillingHeaderTitle = useCallback(
    () => <AnimatedHeaderTitle titleKey="header.billing" />,
    []
  );
  const renderCheckoutHeaderTitle = useCallback(
    () => <AnimatedHeaderTitle titleKey="header.checkout" />,
    []
  );
  const renderPrinterHeaderTitle = useCallback(
    () => <AnimatedHeaderTitle titleKey="header.printerSetup" />,
    []
  );
  const renderHeaderActions = useCallback(
    () => <AnimatedHeaderActions onLogout={logout} />,
    [logout]
  );

  return (
    <Stack.Navigator
      initialRouteName="Billing"
      screenOptions={{
        ...screenOptions,
        animation: "slide_from_right",
        animationDuration: 250,
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
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
    </Stack.Navigator>
  );
}

// ── Main App Navigator (preserves all original logic) ────────────────
export function AppNavigator() {
  const hydrated = useAuthHydration();
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const logout = useSessionReset();

  // Memoized header renderers for the main component scope
  const renderBillingHeaderTitle = useCallback(
    () => <AnimatedHeaderTitle titleKey="header.billing" />,
    []
  );
  const renderCheckoutHeaderTitle = useCallback(
    () => <AnimatedHeaderTitle titleKey="header.checkout" />,
    []
  );
  const renderPrinterHeaderTitle = useCallback(
    () => <AnimatedHeaderTitle titleKey="header.printerSetup" />,
    []
  );
  const renderHeaderActions = useCallback(
    () => <AnimatedHeaderActions onLogout={logout} />,
    [logout]
  );

  // Original effect: clear cart/prices when logged out
  useEffect(() => {
    if (!token || !user) {
      useCartStore.getState().resetCart();
      usePriceStore.getState().clear();
    }
  }, [token, user]);

  // Early return: hydration loading
  if (!hydrated) {
    return <HydrationScreen />;
  }

  // Early return: not authenticated
  if (!token || !user) {
    return (
      <Stack.Navigator initialRouteName="Login" screenOptions={screenOptions}>
        <Stack.Screen
          name="Login"
          getComponent={getLoginScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    );
  }

  // Admin route
  if (user.role === "admin") {
    return (
      <Stack.Navigator
        initialRouteName="AdminDashboard"
        screenOptions={screenOptions}
      >
        <Stack.Screen
          name="AdminDashboard"
          getComponent={getAdminDashboardScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    );
  }

  // Shop route (default)
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

// ── Styles ───────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  hydrationContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  loadingWrapper: {
    marginBottom: 32,
  },
  skeletonWrapper: {
    width: "100%",
    maxWidth: 360,
    gap: 12,
  },
  skeletonHeader: {
    height: 28,
    width: 140,
    backgroundColor: COLORS.border,
    borderRadius: 6,
    marginBottom: 8,
    alignSelf: "center",
  },
  skeletonCard: {
    height: 80,
    backgroundColor: COLORS.border,
    borderRadius: 12,
    opacity: 0.6,
  },
  skeletonRow: {
    flexDirection: "row",
    marginTop: 8,
  },
  skeletonButton: {
    height: 48,
    backgroundColor: COLORS.border,
    borderRadius: 10,
    opacity: 0.5,
  },
});
