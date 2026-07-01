import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type DimensionValue,
  type ViewStyle,
} from "react-native";

import { appTheme } from "@/constants/theme";

export type SkeletonTone = {
  base?: string;
  highlight?: string;
  border?: string;
};

type SkeletonProps = {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  tone?: SkeletonTone;
  style?: ViewStyle;
  animate?: boolean;
};

function useReduceMotion() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);

  return reduceMotion;
}

export function Skeleton({
  width = "100%",
  height = 16,
  borderRadius = 8,
  tone,
  style,
  animate = true,
}: SkeletonProps) {
  const reduceMotion = useReduceMotion();
  const shimmer = useRef(new Animated.Value(-1)).current;
  const base = tone?.base ?? appTheme.card;
  const highlight = tone?.highlight ?? appTheme.surface;
  const border = tone?.border ?? appTheme.border;
  const shouldAnimate = animate && !reduceMotion;

  useEffect(() => {
    if (!shouldAnimate) {
      return;
    }

    const loop = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    );

    loop.start();
    return () => loop.stop();
  }, [shouldAnimate, shimmer]);

  const translateX = shimmer.interpolate({
    inputRange: [-1, 1],
    outputRange: [-220, 220],
  });

  return (
    <View
      style={[
        styles.block,
        {
          width,
          height,
          borderRadius,
          backgroundColor: base,
          borderColor: border,
        },
        style,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {shouldAnimate ? (
        <Animated.View
          style={[
            styles.shimmer,
            {
              backgroundColor: highlight,
              transform: [{ translateX }],
            },
          ]}
        />
      ) : null}
    </View>
  );
}

export function SkeletonListRow({
  tone,
  showAvatar = true,
}: {
  tone?: SkeletonTone;
  showAvatar?: boolean;
}) {
  return (
    <View style={[styles.listRow, tone?.border ? { borderColor: tone.border } : null]}>
      {showAvatar ? (
        <Skeleton width={48} height={48} borderRadius={12} tone={tone} />
      ) : null}
      <View style={styles.listRowBody}>
        <Skeleton width="72%" height={14} borderRadius={6} tone={tone} />
        <Skeleton width="48%" height={12} borderRadius={6} tone={tone} />
      </View>
      <Skeleton width={64} height={32} borderRadius={8} tone={tone} />
    </View>
  );
}

export function SkeletonList({
  rows = 5,
  tone,
  label = "Loading content",
}: {
  rows?: number;
  tone?: SkeletonTone;
  label?: string;
}) {
  return (
    <View
      style={styles.listWrap}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      {Array.from({ length: rows }).map((_, index) => (
        <SkeletonListRow key={index} tone={tone} />
      ))}
    </View>
  );
}

export function SkeletonProductGrid({
  columns = 2,
  rows = 4,
  tone,
  label = "Loading products",
}: {
  columns?: number;
  rows?: number;
  tone?: SkeletonTone;
  label?: string;
}) {
  const items = Array.from({ length: columns * rows });

  return (
    <View
      style={styles.gridWrap}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      {items.map((_, index) => (
        <View
          key={index}
          style={[
            styles.gridItem,
            columns === 2 ? styles.gridItemHalf : styles.gridItemThird,
          ]}
        >
          <Skeleton height={108} borderRadius={12} tone={tone} />
          <Skeleton width="80%" height={12} borderRadius={6} tone={tone} style={styles.gridLine} />
          <Skeleton width="55%" height={10} borderRadius={6} tone={tone} />
        </View>
      ))}
    </View>
  );
}

export function SkeletonDashboard({
  tone,
  label = "Loading dashboard",
}: {
  tone?: SkeletonTone;
  label?: string;
}) {
  return (
    <View
      style={styles.dashboardWrap}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      <Skeleton height={210} borderRadius={14} tone={tone} />
      <View style={styles.dashboardMetrics}>
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} height={88} borderRadius={14} tone={tone} style={styles.dashboardMetric} />
        ))}
      </View>
      <Skeleton height={160} borderRadius={14} tone={tone} />
      <Skeleton height={160} borderRadius={14} tone={tone} />
    </View>
  );
}

export function SkeletonLoadingCaption({ label }: { label: string }) {
  return (
    <Text style={styles.caption} accessibilityRole="text">
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  block: {
    overflow: "hidden",
    borderWidth: 1,
  },
  shimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 120,
    opacity: 0.7,
  },
  listWrap: {
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
  },
  listRowBody: {
    flex: 1,
    gap: 8,
  },
  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  gridItem: {
    gap: 8,
  },
  gridItemHalf: {
    width: "48%",
  },
  gridItemThird: {
    width: "31%",
  },
  gridLine: {
    marginTop: 4,
  },
  dashboardWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  dashboardMetrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  dashboardMetric: {
    width: "47%",
  },
  caption: {
    marginTop: 14,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "600",
    color: appTheme.muted,
  },
});
