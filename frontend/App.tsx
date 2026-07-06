import Constants from "expo-constants";
import "./global.css";

import "./src/navigation/bootstrap";

import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { TamaguiProvider } from "tamagui";

import { AnimatedBrandSplash } from "@/components/animated-brand-splash";
import { appTheme } from "@/constants/theme";
import { useSessionLifecycle } from "@/hooks/use-session-lifecycle";
import { AppNavigator } from "@/navigation/app-navigator";
import { navigationLinking } from "@/navigation/linking";
import { tamaguiConfig } from "./tamagui.config";

SplashScreen.preventAutoHideAsync().catch(() => {
  /* splash already hidden on web reload */
});

SystemUI.setBackgroundColorAsync(appTheme.background).catch(() => {});

if (__DEV__ && Constants.appOwnership !== "expo") {
  void import("expo-dev-client");
}

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: appTheme.background,
    card: appTheme.card,
    text: appTheme.text,
    border: appTheme.border,
    primary: appTheme.accent,
    notification: appTheme.danger,
  },
};

const BOOT_WATCHDOG_MS = 10_000;
const SPLASH_WATCHDOG_MS = 3_000;

export default function App() {
  useSessionLifecycle();
  const [splashAnimationDone, setSplashAnimationDone] = useState(false);
  const [bootTimedOut, setBootTimedOut] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    NotoSansTamil: require("./assets/fonts/NotoSansTamil.ttf"),
  });

  const handleSplashFinish = useCallback(async () => {
    await SplashScreen.hideAsync();
    setSplashAnimationDone(true);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setBootTimedOut(true), BOOT_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if ((!fontsLoaded && !fontError) || splashAnimationDone) {
      return;
    }
    const timer = setTimeout(() => {
      void handleSplashFinish();
    }, SPLASH_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [fontError, fontsLoaded, handleSplashFinish, splashAnimationDone]);

  const appReady = (fontsLoaded || Boolean(fontError) || bootTimedOut) && splashAnimationDone;

  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <NavigationContainer theme={navigationTheme} linking={navigationLinking}>
            <AppNavigator bootReady={appReady} />
          </NavigationContainer>
          {fontsLoaded && !splashAnimationDone ? (
            <AnimatedBrandSplash onFinish={handleSplashFinish} />
          ) : null}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </TamaguiProvider>
  );
}
