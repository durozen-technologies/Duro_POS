import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { branding } from "@/constants/branding";
import { appTheme } from "@/constants/theme";

const LOGO_IMAGE = require("../../assets/Logo.png");

type BootLoaderProps = {
  label?: string;
  style?: StyleProp<ViewStyle>;
  showTitle?: boolean;
};

export function BootLoader({
  label = "Preparing your workspace...",
  style,
  showTitle = true,
}: BootLoaderProps) {
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(10)).current;
  const logoScale = useRef(new Animated.Value(0.96)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(rise, {
        toValue: 0,
        damping: 16,
        stiffness: 120,
        mass: 0.85,
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        damping: 14,
        stiffness: 110,
        mass: 0.85,
        useNativeDriver: true,
      }),
    ]).start();

    const barLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: false,
        }),
      ]),
    );

    barLoop.start();
    return () => barLoop.stop();
  }, [fade, logoScale, progress, rise]);

  const barWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["28%", "88%"],
  });

  return (
    <View style={[styles.container, style]}>
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fade,
            transform: [{ translateY: rise }, { scale: logoScale }],
          },
        ]}
      >
        <Image
          source={LOGO_IMAGE}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel={`${branding.appName} logo`}
        />

        {showTitle ? <Text style={styles.title}>{branding.appName}</Text> : null}
        <Text style={styles.label}>{label}</Text>

        <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel={label}>
          <Animated.View style={[styles.bar, { width: barWidth }]} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: branding.splashBackground,
    paddingHorizontal: 28,
  },
  content: {
    width: "100%",
    maxWidth: 320,
    alignItems: "center",
  },
  logo: {
    width: branding.logoWidth,
    height: branding.logoHeight,
  },
  title: {
    marginTop: 18,
    color: appTheme.text,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.02,
  },
  label: {
    marginTop: 8,
    color: appTheme.muted,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  track: {
    marginTop: 22,
    width: "72%",
    maxWidth: 220,
    height: 4,
    borderRadius: 99,
    backgroundColor: appTheme.border,
    overflow: "hidden",
  },
  bar: {
    height: 4,
    borderRadius: 99,
    backgroundColor: appTheme.accent,
  },
});
