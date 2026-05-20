import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { memo, useEffect, useMemo, useRef } from "react";
import {
  AccessibilityRole,
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  StyleProp,
  Text,
  TextStyle,
  TextInput,
  View,
  ViewStyle,
} from "react-native";

import { adminShadow, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic, type ToastTone } from "../admin-dashboard-utils";

type MetricCardProps = {
  label: string;
  value: number;
  formatter: (value: number) => string;
  note: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  accent: string;
  accentSoft: string;
  palette: ThemePalette;
  sparklineValues?: number[];
  sparklineLabel?: string;
  noteIcon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  fullWidth?: boolean;
};

type SectionCardProps = {
  title: string;
  subtitle: string;
  collapsed?: boolean;
  onToggle?: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
  palette: ThemePalette;
};

type SearchFieldProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  palette: ThemePalette;
  accessibilityLabel?: string;
};

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger" | "accent" | "warning" | "contrast";
  fullWidth?: boolean;
  palette: ThemePalette;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  accessibilityLabel?: string;
  backgroundColorOverride?: string;
  borderColorOverride?: string;
  textColorOverride?: string;
};

type EmptyStateCardProps = {
  title: string;
  subtitle: string;
  palette: ThemePalette;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  actionLabel?: string;
  onAction?: () => void;
};

type ToastBannerProps = {
  toast: { tone: ToastTone; message: string } | null;
  palette: ThemePalette;
  animatedValue: Animated.Value;
};

type BottomNavProps = {
  items: { key: string; label: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"] }[];
  activeKey: string;
  onSelect: (key: string) => void;
  palette: ThemePalette;
  bottomOffset: number;
};

type TopAppBarProps = {
  shopName: string;
  onShopPress: () => void;
  periodLabel: string;
  onPeriodPress: () => void;
  palette: ThemePalette;
  topInset: number;
  isOffline?: boolean;
  onThemeToggle?: () => void;
  isDark?: boolean;
  onRefresh?: () => void;
};

type DashboardErrorBannerProps = {
  dashboardError: string | null;
  hasShops: boolean;
  palette: ThemePalette;
  style?: StyleProp<ViewStyle>;
};

type TabSectionHeaderProps = {
  title: string;
  palette: ThemePalette;
  badgeLabel?: string;
};

type SectionHintProps = {
  text: string;
  palette: ThemePalette;
  style?: StyleProp<ViewStyle>;
};

function CountUpText({
  value,
  formatter,
  style,
}: {
  value: number;
  formatter: (value: number) => string;
  style: StyleProp<TextStyle>;
}) {
  const emphasis = useRef(new Animated.Value(1)).current;
  const previousValueRef = useRef(value);
  const formattedValue = useMemo(() => formatter(value), [formatter, value]);

  useEffect(() => {
    if (previousValueRef.current === value) {
      return;
    }

    previousValueRef.current = value;
    emphasis.setValue(0.96);
    Animated.spring(emphasis, {
      toValue: 1,
      speed: 20,
      bounciness: 3,
      useNativeDriver: true,
    }).start();
  }, [emphasis, value]);

  return (
    <Animated.Text
      adjustsFontSizeToFit
      minimumFontScale={0.74}
      numberOfLines={1}
      style={[style, { transform: [{ scale: emphasis }] }]}
    >
      {formattedValue}
    </Animated.Text>
  );
}

function Sparkline({
  values,
  accent,
}: {
  values: number[];
  accent: string;
}) {
  const normalizedHeights = useMemo(() => {
    const max = Math.max(...values, 1);
    return values.map((value) => Math.max(10, (value / max) * 34));
  }, [values]);

  return (
    <View style={styles.sparklineRow}>
      {normalizedHeights.map((height, index) => (
        <View
          key={`${height}-${index}`}
          style={[styles.sparklineBar, { height, backgroundColor: accent }]}
        />
      ))}
    </View>
  );
}

export const MetricCard = memo(function MetricCard({
  label,
  value,
  formatter,
  note,
  icon,
  accent,
  accentSoft,
  palette,
  sparklineValues = [4, 6, 5, 8, 7, 9],
  sparklineLabel = "Scope spread",
  noteIcon = "information-outline",
  fullWidth = false,
}: MetricCardProps) {
  return (
    <View
      accessible
      accessibilityLabel={`${label} ${formatter(value)}`}
      style={[
        styles.metricCard,
        fullWidth && styles.metricCardFullWidth,
        adminShadow(palette.shadow, 0.06, 8, 16),
        {
          backgroundColor: palette.card,
          borderColor: palette.border,
        },
      ]}
    >
      <View style={[styles.metricAccentBar, { backgroundColor: accent }]} />
      <View style={styles.metricHeader}>
        <View style={styles.metricHeaderText}>
          <Text style={[styles.metricLabel, { color: palette.textSecondary }]}>{label}</Text>
          <CountUpText value={value} formatter={formatter} style={[styles.metricValue, { color: palette.textPrimary }]} />
        </View>
        <View style={[styles.metricIconWrap, { backgroundColor: accentSoft, borderColor: palette.border }]}>
          <MaterialCommunityIcons name={icon} size={18} color={accent} />
        </View>
      </View>
      <View style={styles.metricTrendRow}>
        <Text style={[styles.metricTrendLabel, { color: palette.textMuted }]}>{sparklineLabel}</Text>
        <Sparkline values={sparklineValues} accent={accent} />
      </View>
      <View style={[styles.metricNoteWrap, { backgroundColor: accentSoft }]}>
        <MaterialCommunityIcons name={noteIcon} size={14} color={accent} style={styles.metricNoteIcon} />
        <Text numberOfLines={2} style={[styles.metricNote, { color: palette.textPrimary }]}>
          {note}
        </Text>
      </View>
    </View>
  );
});

export const SectionCard = memo(function SectionCard({
  title,
  subtitle,
  collapsed = false,
  onToggle,
  action,
  children,
  palette,
}: SectionCardProps) {
  return (
    <View
      style={[
        styles.sectionCard,
        adminShadow(palette.shadow, 0.05, 8, 16),
        { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      <Pressable
        disabled={!onToggle}
        accessibilityRole={onToggle ? "button" : undefined}
        onPress={onToggle}
        style={styles.sectionHeader}
      >
        <View style={styles.sectionHeaderText}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>{title}</Text>
          <Text style={[styles.sectionSubtitle, { color: palette.textMuted }]}>{subtitle}</Text>
        </View>
        <View style={styles.sectionHeaderActions}>
          {action}
          {onToggle ? (
            <View style={[styles.chevronWrap, { backgroundColor: palette.backgroundElevated }]}>
              <MaterialCommunityIcons
                name={collapsed ? "chevron-down" : "chevron-up"}
                size={18}
                color={palette.textSecondary}
              />
            </View>
          ) : null}
        </View>
      </Pressable>
      {!collapsed ? children : null}
    </View>
  );
});

export const SearchField = memo(function SearchField({
  value,
  onChangeText,
  placeholder,
  palette,
  accessibilityLabel,
}: SearchFieldProps) {
  return (
    <View style={[styles.searchField, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
      <MaterialCommunityIcons name="magnify" size={16} color={palette.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        style={[styles.searchInput, { color: palette.textPrimary }]}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        returnKeyType="search"
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText("")}
          hitSlop={12}
        >
          <MaterialCommunityIcons name="close-circle" size={16} color={palette.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
});

export const ChipButton = memo(function ChipButton({
  label,
  onPress,
  active,
  palette,
  icon,
  accessibilityRole = "button",
}: {
  label: string;
  onPress: () => void;
  active: boolean;
  palette: ThemePalette;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  accessibilityRole?: AccessibilityRole;
}) {
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      onPress={() => {
        triggerHaptic();
        onPress();
      }}
      style={[
        styles.chipButton,
        {
          backgroundColor: active ? palette.emeraldSoft : palette.surfaceMuted,
          borderColor: active ? palette.emerald : palette.border,
        },
      ]}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={14} color={active ? palette.emeraldDark : palette.textMuted} /> : null}
      <Text style={[styles.chipText, { color: active ? palette.emeraldDark : palette.textSecondary }]}>{label}</Text>
    </Pressable>
  );
});

export const PrimaryButton = memo(function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = "primary",
  fullWidth = false,
  palette,
  icon,
  accessibilityLabel,
  backgroundColorOverride,
  borderColorOverride,
  textColorOverride,
}: PrimaryButtonProps) {
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";
  const isAccent = variant === "accent";
  const isWarning = variant === "warning";
  const isContrast = variant === "contrast";
  const isDisabled = loading || disabled;
  const isSolid = isPrimary || isDanger || isAccent || isWarning || isContrast;

  const buttonBackground = backgroundColorOverride ?? (isPrimary
    ? palette.emerald
    : isDanger
      ? palette.danger
      : isAccent
        ? palette.upi
        : isWarning
          ? palette.cash
          : isContrast
            ? palette.textPrimary
            : palette.card);
  const buttonBorder = borderColorOverride ?? (isPrimary
    ? palette.emerald
    : isDanger
      ? palette.danger
      : isAccent
        ? palette.upi
        : isWarning
          ? palette.cash
          : isContrast
            ? palette.textPrimary
            : palette.border);
  const textColor = textColorOverride ?? (isPrimary
    ? "#FFFFFF"
    : isDanger
      ? "#FFFFFF"
      : isAccent
        ? "#FFFFFF"
        : isWarning
          ? "#201505"
          : isContrast
            ? palette.background
            : palette.textPrimary);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled }}
      onPress={() => {
        if (isDisabled) {
          return;
        }
        triggerHaptic(isSolid ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.buttonBase,
        adminShadow(palette.shadow, isSolid ? 0.1 : 0.04, 8, 16),
        {
          width: fullWidth ? "100%" : undefined,
          backgroundColor: buttonBackground,
          borderColor: buttonBorder,
          opacity: disabled && !loading ? 0.75 : 1,
          transform: [{ scale: pressed && !isDisabled ? 0.99 : 1 }, { translateY: pressed && !isDisabled ? 1 : 0 }],
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <View style={styles.buttonContent}>
          {icon ? <MaterialCommunityIcons name={icon} size={17} color={textColor} /> : null}
          <Text style={[styles.buttonLabel, { color: textColor }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
});

export const EmptyStateCard = memo(function EmptyStateCard({
  title,
  subtitle,
  palette,
  icon = "star-outline",
  actionLabel,
  onAction,
}: EmptyStateCardProps) {
  return (
    <View style={[styles.emptyCard, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
      <View style={[styles.emptyIconWrap, { backgroundColor: palette.card }]}>
        <MaterialCommunityIcons name={icon} size={24} color={palette.emerald} />
      </View>
      <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>{title}</Text>
      <Text style={[styles.emptySubtitle, { color: palette.textMuted }]}>{subtitle}</Text>
      {actionLabel && onAction ? (
        <PrimaryButton
          label={actionLabel}
          onPress={onAction}
          palette={palette}
          variant="secondary"
        />
      ) : null}
    </View>
  );
});

export const DashboardErrorBanner = memo(function DashboardErrorBanner({
  dashboardError,
  hasShops,
  palette,
  style,
}: DashboardErrorBannerProps) {
  if (!dashboardError || !hasShops) {
    return null;
  }

  return (
    <View style={[styles.inlineBanner, style, { backgroundColor: palette.goldSoft, borderColor: palette.gold }]}>
      <MaterialCommunityIcons name="wifi-alert" size={18} color={palette.cash} />
      <Text style={[styles.inlineBannerText, { color: palette.textPrimary }]}>{dashboardError}</Text>
    </View>
  );
});

export const TabSectionHeader = memo(function TabSectionHeader({
  title,
  palette,
  badgeLabel,
}: TabSectionHeaderProps) {
  return (
    <View style={styles.tabSectionHeader}>
      <Text style={[styles.tabSectionTitle, { color: palette.textPrimary }]}>{title}</Text>
      {badgeLabel ? (
        <View style={styles.sectionBadge}>
          <Text
            style={[
              styles.sectionBadgeText,
              { color: palette.emeraldDark, backgroundColor: palette.emeraldSoft },
            ]}
          >
            {badgeLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

export const SectionHint = memo(function SectionHint({ text, palette, style }: SectionHintProps) {
  return (
    <Text style={[styles.sectionHint, style, { color: palette.textMuted }]}>
      {text}
    </Text>
  );
});

export function ToastBanner({ toast, palette, animatedValue }: ToastBannerProps) {
  if (!toast) {
    return null;
  }

  const toneColor = toast.tone === "success" ? palette.success : palette.danger;
  const toneBackground = toast.tone === "success" ? palette.successSoft : palette.dangerSoft;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toastContainer,
        adminShadow(palette.shadow, 0.08, 8, 14),
        {
          backgroundColor: toneBackground,
          borderColor: toneColor,
          opacity: animatedValue,
          transform: [
            {
              translateY: animatedValue.interpolate({
                inputRange: [0, 1],
                outputRange: [-18, 0],
              }),
            },
          ],
        },
      ]}
    >
      <MaterialCommunityIcons
        name={toast.tone === "success" ? "check-circle-outline" : "alert-circle-outline"}
        size={18}
        color={toneColor}
      />
      <Text style={[styles.toastText, { color: toneColor }]}>{toast.message}</Text>
    </Animated.View>
  );
}

function ShimmerBlock({
  height,
  borderRadius,
  palette,
}: {
  height: number;
  borderRadius: number;
  palette: ThemePalette;
}) {
  const shimmer = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
    );

    animation.start();
    return () => animation.stop();
  }, [shimmer]);

  const translateX = shimmer.interpolate({
    inputRange: [-1, 1],
    outputRange: [-220, 220],
  });

  return (
    <View
      style={[
        styles.skeletonBlock,
        {
          height,
          borderRadius,
          borderColor: palette.border,
          backgroundColor: palette.card,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.skeletonShimmer,
          {
            backgroundColor: palette.glass,
            transform: [{ translateX }],
          },
        ]}
      />
    </View>
  );
}

export function DashboardSkeleton({ palette }: { palette: ThemePalette }) {
  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <View style={styles.skeletonWrap}>
        <ShimmerBlock height={210} borderRadius={28} palette={palette} />
        <View style={styles.skeletonMetricGrid}>
          {Array.from({ length: 4 }).map((_, index) => (
            <ShimmerBlock key={index} height={122} borderRadius={24} palette={palette} />
          ))}
        </View>
        <ShimmerBlock height={180} borderRadius={26} palette={palette} />
        <ShimmerBlock height={180} borderRadius={26} palette={palette} />
      </View>
    </View>
  );
}

export const BottomNav = memo(function BottomNav({
  items,
  activeKey,
  onSelect,
  palette,
  bottomOffset,
}: BottomNavProps) {
  return (
    <View
      style={[
        styles.bottomNavWrap,
        adminShadow(palette.shadow, 0.14, 20, 28),
        {
          backgroundColor: palette.navBackdrop,
          borderColor: palette.glassBorder,
          bottom: bottomOffset + 8,
        },
      ]}
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            onPress={() => {
              triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
              onSelect(item.key);
            }}
            style={styles.bottomNavItem}
          >
            {active ? <View style={[styles.activeNavIndicator, { backgroundColor: palette.emeraldSoft }]} /> : null}
            <MaterialCommunityIcons
              name={item.icon}
              size={22}
              color={active ? palette.emerald : palette.textMuted}
            />
            {active ? (
              <Text style={[styles.bottomNavLabel, { color: palette.emerald }]}>{item.label}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
});

// ─── TOP APP BAR ────────────────────────────────────────────────────
export const TopAppBar = memo(function TopAppBar({
  shopName,
  onShopPress,
  periodLabel,
  onPeriodPress,
  palette,
  topInset,
  isOffline = false,
  onThemeToggle,
  isDark = false,
  onRefresh,
}: TopAppBarProps) {
  return (
    <View
      style={[
        styles.topAppBar,
        adminShadow(palette.shadow, 0.04, 6, 10),
        { paddingTop: topInset + 10, backgroundColor: palette.background, borderBottomColor: palette.border },
      ]}
    >
      {/* LEFT: Shop + Period stacked */}
      <View style={styles.topAppLeft}>
        <Pressable onPress={onShopPress} style={styles.topAppShopRow} accessibilityRole="button" accessibilityLabel="Switch branch">
          <MaterialCommunityIcons name="storefront-outline" size={16} color={palette.emerald} />
          <Text style={[styles.topAppShopName, { color: palette.textPrimary }]} numberOfLines={1}>{shopName}</Text>
          <MaterialCommunityIcons name="chevron-down" size={18} color={palette.textMuted} />
        </Pressable>
        <Pressable onPress={onPeriodPress} style={styles.topAppPeriodRow} accessibilityRole="button" accessibilityLabel="Change analytics period">
          <View style={[styles.liveDot, { backgroundColor: isOffline ? palette.gold : palette.success }]} />
          <Text style={[styles.topAppPeriodText, { color: palette.textMuted }]}>{periodLabel}</Text>
          <MaterialCommunityIcons name="chevron-down" size={14} color={palette.textMuted} />
        </Pressable>
      </View>

      {/* RIGHT: Action icons */}
      <View style={styles.topAppActions}>
        <Pressable
          onPress={onRefresh}
          style={[styles.topAppIconBtn, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}
          accessibilityRole="button"
          accessibilityLabel="Refresh"
        >
          <MaterialCommunityIcons name="refresh" size={19} color={palette.textPrimary} />
        </Pressable>
        <Pressable
          onPress={onThemeToggle}
          style={[styles.topAppIconBtn, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}
          accessibilityRole="button"
          accessibilityLabel={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          <MaterialCommunityIcons
            name={isDark ? "white-balance-sunny" : "weather-night"}
            size={19}
            color={palette.textPrimary}
          />
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  metricCard: {
    flexBasis: "47.2%",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 148,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 8,
    justifyContent: "space-between",
    overflow: "hidden",
    position: "relative",
  },
  metricCardFullWidth: {
    flexBasis: "100%",
  },
  metricAccentBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  metricHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  metricHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  metricIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  metricTrendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  metricTrendLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  sparklineRow: {
    height: 20,
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "flex-end",
    gap: 3,
  },
  sparklineBar: {
    width: 3,
    borderRadius: 999,
    opacity: 0.4,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metricValue: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
  },
  metricNoteWrap: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  metricNoteIcon: {
    marginTop: 1,
  },
  metricNote: {
    fontSize: 11,
    lineHeight: 16,
    minHeight: 32,
    flex: 1,
  },
  sectionCard: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  sectionHeaderText: {
    flex: 1,
    gap: 3,
  },
  sectionHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "700",
  },
  sectionSubtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
  chevronWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  searchField: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  chipButton: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  buttonBase: {
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    width: "100%",
  },
  buttonLabel: {
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "center",
  },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 10,
    alignItems: "flex-start",
  },
  emptyIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  emptySubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  inlineBanner: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inlineBannerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  tabSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 4,
  },
  tabSectionTitle: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.5,
    flex: 1,
  },
  sectionBadge: {
    justifyContent: "center",
  },
  sectionBadgeText: {
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: "600",
  },
  sectionHint: {
    fontSize: 12,
    lineHeight: 18,
  },
  toastContainer: {
    position: "absolute",
    top: 12,
    left: 16,
    right: 16,
    zIndex: 50,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  toastText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  skeletonWrap: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  skeletonMetricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  skeletonBlock: {
    overflow: "hidden",
    borderWidth: 1,
  },
  skeletonShimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 120,
    opacity: 0.7,
  },
  bottomNavWrap: {
    position: "absolute",
    left: 20,
    right: 20,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  bottomNavItem: {
    minWidth: 0,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    minHeight: 56,
    paddingHorizontal: 4,
    borderRadius: 999,
  },
  activeNavIndicator: {
    position: "absolute",
    top: 4,
    bottom: 4,
    left: 6,
    right: 6,
    borderRadius: 999,
  },
  bottomNavLabel: {
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: 0.2,
  },
  // Top App Bar
  topAppBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    zIndex: 20,
  },
  topAppLeft: {
    flex: 1,
    gap: 4,
    marginRight: 12,
  },
  topAppShopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  topAppShopName: {
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: -0.5,
    flexShrink: 1,
  },
  topAppPeriodRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  topAppPeriodText: {
    fontSize: 13,
    fontWeight: "600",
  },
  topAppActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  topAppIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
});
