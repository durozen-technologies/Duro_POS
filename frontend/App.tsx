import Constants from "expo-constants";
import "./global.css";

import "./src/navigation/bootstrap";

import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import { useCallback, useState } from "react";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { TamaguiProvider } from "tamagui";

import { AnimatedBrandSplash } from "@/components/animated-brand-splash";
import { appTheme } from "@/constants/theme";
import { AppNavigator } from "@/navigation/app-navigator";
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

export default function App() {
  const [splashAnimationDone, setSplashAnimationDone] = useState(false);
  const [fontsLoaded] = useFonts({
    NotoSansTamil: require("./assets/fonts/NotoSansTamil.ttf"),
  });

  const handleSplashFinish = useCallback(async () => {
    await SplashScreen.hideAsync();
    setSplashAnimationDone(true);
  }, []);

  const appReady = fontsLoaded && splashAnimationDone;

  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <NavigationContainer theme={navigationTheme}>
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
