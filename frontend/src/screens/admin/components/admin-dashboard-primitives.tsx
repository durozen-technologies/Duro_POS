import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  AccessibilityRole,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  StyleProp,
  Text,
  TextStyle,
  TextInput,
  View,
  ViewStyle,
} from "react-native";

import { SkeletonDashboard } from "@/components/ui/skeleton";
import {
  adminElevation,
  adminPressOpacity,
  adminPressScale,
  adminRadii,
  adminSpacing,
  adminTypography,
  type ThemePalette,
} from "../admin-dashboard-theme";
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
  /** @deprecated Sparklines removed — kept for call-site compat. */
  sparklineValues?: number[];
  /** @deprecated Sparklines removed — kept for call-site compat. */
  sparklineLabel?: string;
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
  variant?: "primary" | "secondary" | "danger" | "accent" | "warning" | "success" | "info" | "contrast";
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
  badgeBackgroundColor?: string;
  badgeTextColor?: string;
};

type SectionHintProps = {
  text: string;
  palette: ThemePalette;
  style?: StyleProp<ViewStyle>;
};

export type ActionTone = "primary" | "neutral" | "danger" | "success" | "warning" | "info";

export function usePressAnimation(disabled = false) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const onPressIn = useCallback(() => {
    if (disabled) return;
    Animated.parallel([
      Animated.timing(scale, {
        toValue: adminPressScale,
        duration: 100,
        easing: Easing.bezier(0.25, 1, 0.5, 1),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: adminPressOpacity,
        duration: 100,
        easing: Easing.bezier(0.25, 1, 0.5, 1),
        useNativeDriver: true,
      }),
    ]).start();
  }, [disabled, opacity, scale]);

  const onPressOut = useCallback(() => {
    Animated.parallel([
      Animated.timing(scale, {
        toValue: 1,
        duration: 200,
        easing: Easing.bezier(0.25, 1, 0.5, 1),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        easing: Easing.bezier(0.25, 1, 0.5, 1),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale]);

  return { scale, opacity, onPressIn, onPressOut };
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
  fullWidth = false,
}: MetricCardProps) {
  const formattedValue = useMemo(() => formatter(value), [formatter, value]);

  return (
    <View
      accessible
      accessibilityLabel={`${label} ${formattedValue}`}
      style={[
        styles.metricCard,
        fullWidth && styles.metricCardFullWidth,
        {
          backgroundColor: palette.card,
          borderColor: palette.border,
        },
      ]}
    >
      <View style={styles.metricHeader}>
        <View style={styles.metricHeaderText}>
          <Text style={[styles.metricLabel, { color: palette.textMuted }]}>{label}</Text>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            numberOfLines={1}
            style={[styles.metricValue, { color: palette.textPrimary }]}
          >
            {formattedValue}
          </Text>
        </View>
        <MaterialCommunityIcons name={icon} size={18} color={palette.textMuted} accessibilityElementsHidden />
      </View>
      {note ? (
        <Text numberOfLines={2} style={[styles.metricNote, { color: palette.textSecondary }]}>
          {note}
        </Text>
      ) : null}
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
  const rotation = useRef(new Animated.Value(collapsed ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: collapsed ? 0 : 1,
      duration: 250,
      easing: Easing.bezier(0.25, 1, 0.5, 1),
      useNativeDriver: true,
    }).start();
  }, [collapsed, rotation]);

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  return (
    <View
      style={[
        styles.sectionCard,
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
            <Animated.View style={[styles.chevronWrap, { backgroundColor: palette.backgroundElevated, transform: [{ rotate: spin }] }]}>
              <MaterialCommunityIcons
                name="chevron-down"
                size={18}
                color={palette.textSecondary}
              />
            </Animated.View>
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
  const { scale, opacity, onPressIn, onPressOut } = usePressAnimation();

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      onPress={() => {
        triggerHaptic();
        onPress();
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <Animated.View
        style={[
          styles.chipButton,
          {
            backgroundColor: active ? palette.primarySoft : palette.surfaceMuted,
            borderColor: active ? palette.primary : palette.border,
            opacity,
            transform: [{ scale }],
          },
        ]}
      >
        {icon ? <MaterialCommunityIcons name={icon} size={14} color={active ? palette.primaryStrong : palette.textMuted} /> : null}
        <Text style={[styles.chipText, { color: active ? palette.primaryStrong : palette.textSecondary }]}>{label}</Text>
      </Animated.View>
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
  const isSuccess = variant === "success";
  const isInfo = variant === "info";
  const isContrast = variant === "contrast";
  const isDisabled = loading || disabled;
  const isSolid = isPrimary || isDanger || isAccent || isWarning || isSuccess || isInfo || isContrast;

  const buttonBackground = backgroundColorOverride ?? (isPrimary
    ? palette.primary
    : isDanger
      ? palette.danger
      : isSuccess
        ? palette.success
        : isInfo
          ? palette.primaryStrong
      : isAccent
        ? palette.upi
        : isWarning
          ? palette.cash
          : isContrast
            ? palette.textPrimary
            : palette.card);
  const buttonBorder = borderColorOverride ?? (isPrimary
    ? palette.primary
    : isDanger
      ? palette.danger
      : isSuccess
        ? palette.success
        : isInfo
          ? palette.primaryStrong
      : isAccent
        ? palette.upi
        : isWarning
          ? palette.cash
          : isContrast
            ? palette.textPrimary
            : palette.border);
  const textColor = textColorOverride ?? (isPrimary
    ? palette.onPrimary
    : isDanger
      ? "#FFFFFF"
      : isSuccess
        ? "#FFFFFF"
        : isInfo
          ? "#FFFFFF"
      : isAccent
        ? "#FFFFFF"
      : isWarning
          ? palette.onCash
          : isContrast
            ? palette.background
            : palette.textPrimary);

  const { scale, opacity, onPressIn, onPressOut } = usePressAnimation(isDisabled);

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
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={isDisabled}
      style={{ width: fullWidth ? "100%" : undefined }}
    >
      <Animated.View
        style={[
          styles.buttonBase,
          isSolid ? null : { borderWidth: 1 },
          {
            backgroundColor: buttonBackground,
            borderColor: buttonBorder,
            opacity: isDisabled ? 0.55 : opacity,
            transform: [{ scale }],
            width: fullWidth ? "100%" : undefined,
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
      </Animated.View>
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
        <MaterialCommunityIcons name={icon} size={24} color={palette.primary} />
      </View>
      <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>{title}</Text>
      <Text style={[styles.emptySubtitle, { color: palette.textMuted }]}>{subtitle}</Text>
      {actionLabel && onAction ? (
        <View style={{ marginTop: adminSpacing.sm }}>
          <PrimaryButton
            label={actionLabel}
            onPress={onAction}
            palette={palette}
            variant="secondary"
          />
        </View>
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
  badgeBackgroundColor,
  badgeTextColor,
}: TabSectionHeaderProps) {
  return (
    <View style={styles.tabSectionHeader}>
      <Text style={[styles.tabSectionTitle, { color: palette.textPrimary }]}>{title}</Text>
      {badgeLabel ? (
        <View style={styles.sectionBadge}>
          <Text
            style={[
              styles.sectionBadgeText,
              {
                color: badgeTextColor ?? palette.primaryStrong,
                backgroundColor: badgeBackgroundColor ?? palette.primarySoft,
              },
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
        adminElevation(2),
        {
          backgroundColor: toneBackground,
          borderColor: toneColor,
          opacity: animatedValue,
          transform: [
            {
              translateY: animatedValue.interpolate({
                inputRange: [0, 1],
                outputRange: [-12, 0],
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

export function DashboardSkeleton({ palette }: { palette: ThemePalette }) {
  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <SkeletonDashboard
        tone={{
          base: palette.card,
          highlight: palette.glass,
          border: palette.border,
        }}
        label="Loading dashboard"
      />
    </View>
  );
}

const BOTTOM_NAV_ITEM_MIN_WIDTH = 68;

const BottomNavItem = memo(function BottomNavItem({
  item,
  activeKey,
  onSelect,
  palette,
}: {
  item: { key: string; label: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"] };
  activeKey: string;
  onSelect: (key: string) => void;
  palette: ThemePalette;
}) {
  const active = item.key === activeKey;
  const { scale, opacity, onPressIn, onPressOut } = usePressAnimation();
  const iconColor = active ? palette.primary : palette.onShellMuted;
  const textColor = active ? palette.primaryStrong : palette.onShellMuted;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={item.label}
      onPress={() => {
        triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
        onSelect(item.key);
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={styles.bottomNavItemBase}
    >
      <View
        style={[
          styles.bottomNavItemSurface,
          active ? { backgroundColor: palette.primarySoft } : null,
        ]}
      >
        <Animated.View
          style={[
            styles.bottomNavItemContent,
            {
              opacity,
              transform: [{ scale }],
            },
          ]}
        >
          <View style={styles.bottomNavIndicatorSlot}>
            {active ? (
              <View style={[styles.bottomNavIndicator, { backgroundColor: palette.primary }]} />
            ) : (
              <View style={styles.bottomNavIndicatorSpacer} />
            )}
          </View>
          <MaterialCommunityIcons name={item.icon} size={active ? 22 : 20} color={iconColor} />
          <Text
            numberOfLines={1}
            style={[
              styles.bottomNavLabel,
              { color: textColor, fontWeight: active ? "700" : "600" },
            ]}
          >
            {item.label}
          </Text>
        </Animated.View>
      </View>
    </Pressable>
  );
});

export const BottomNav = memo(function BottomNav({
  items,
  activeKey,
  onSelect,
  palette,
  bottomOffset,
}: BottomNavProps) {
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bottomNavDock,
        {
          backgroundColor: palette.shell,
          borderTopColor: palette.shellBorder,
          paddingBottom: bottomOffset,
        },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.bottomNavTrack}
        keyboardShouldPersistTaps="handled"
      >
        {items.map((item) => (
          <BottomNavItem
            key={item.key}
            item={item}
            activeKey={activeKey}
            onSelect={onSelect}
            palette={palette}
          />
        ))}
      </ScrollView>
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
        { paddingTop: topInset + adminSpacing.sm, backgroundColor: palette.shell, borderBottomColor: palette.shellBorder },
      ]}
    >
      {/* LEFT: Shop + Period stacked */}
      <View style={styles.topAppLeft}>
        <TopAppBarIconRow onPress={onShopPress} label="Switch branch" palette={palette} isPeriod={false}>
          <MaterialCommunityIcons name="storefront-outline" size={16} color={palette.primary} />
          <Text style={[styles.topAppShopName, { color: palette.onShell }]} numberOfLines={1}>{shopName}</Text>
          <MaterialCommunityIcons name="chevron-down" size={18} color={palette.onShellMuted} />
        </TopAppBarIconRow>
        <TopAppBarIconRow onPress={onPeriodPress} label="Change analytics period" palette={palette} isPeriod={true}>
          <View style={[styles.liveDot, { backgroundColor: isOffline ? palette.gold : palette.success }]} />
          <Text style={[styles.topAppPeriodText, { color: palette.onShellMuted }]}>{periodLabel}</Text>
          <MaterialCommunityIcons name="chevron-down" size={14} color={palette.onShellMuted} />
        </TopAppBarIconRow>
      </View>

      {/* RIGHT: Action icons */}
      <View style={styles.topAppActions}>
        <TopAppBarIconButton
          onPress={onRefresh}
          label="Refresh"
          palette={palette}
        >
          <MaterialCommunityIcons name="refresh" size={19} color={palette.onShell} />
        </TopAppBarIconButton>
        <TopAppBarIconButton
          onPress={onThemeToggle}
          label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          palette={palette}
        >
          <MaterialCommunityIcons
            name={isDark ? "white-balance-sunny" : "weather-night"}
            size={19}
            color={palette.onShell}
          />
        </TopAppBarIconButton>
      </View>
    </View>
  );
});

export const ActionButton = memo(function ActionButton({
  label,
  icon,
  palette,
  tone = "neutral",
  active = false,
  danger = false,
  loading = false,
  disabled = false,
  onPress,
  compact = false,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  palette: ThemePalette;
  tone?: ActionTone;
  active?: boolean;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  compact?: boolean;
}) {
  let fg = disabled ? palette.textMuted : danger ? palette.danger : active ? palette.onPrimary : palette.textPrimary;
  let bg = disabled ? palette.surfaceMuted : danger ? palette.dangerSoft : active ? palette.primary : palette.card;
  let border = disabled ? palette.border : danger ? palette.danger : active ? palette.primary : palette.border;

  if (!disabled) {
    if (tone === "danger") {
      fg = palette.danger;
      bg = active ? palette.dangerSoft : palette.card;
      border = palette.danger;
    } else if (tone === "success") {
      fg = active ? palette.onPrimary : palette.success;
      bg = active ? palette.success : palette.successSoft;
      border = palette.success;
    } else if (tone === "warning") {
      fg = active ? palette.onCash : palette.warning;
      bg = active ? palette.cash : palette.warningSoft;
      border = palette.warning;
    } else if (tone === "info") {
      fg = active ? palette.onPrimary : palette.primaryStrong;
      bg = active ? palette.primary : palette.primarySoft;
      border = palette.primaryStrong;
    } else if (tone === "primary") {
      fg = active ? palette.onPrimary : palette.primaryStrong;
      bg = active ? palette.primary : palette.primarySoft;
      border = palette.primary;
    }
  }

  const { scale, opacity, onPressIn, onPressOut } = usePressAnimation(disabled || loading);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={() => {
        if (!disabled && !loading) {
          triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <Animated.View
        style={[
          styles.actionButton,
          compact && styles.actionButtonCompact,
          { borderColor: border, backgroundColor: bg, opacity: loading || disabled ? 0.65 : opacity, transform: [{ scale }] },
        ]}
      >
        {icon ? <MaterialCommunityIcons name={icon} size={compact ? 14 : 16} color={fg} /> : null}
        <Text numberOfLines={1} style={[styles.actionText, compact && styles.actionTextCompact, { color: fg }]}>
          {loading ? "..." : label}
        </Text>
      </Animated.View>
    </Pressable>
  );
});

export const IconButton = memo(function IconButton({
  icon,
  label,
  palette,
  tone,
  danger = false,
  disabled = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  palette: ThemePalette;
  tone?: ActionTone;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  let fg = disabled ? palette.textMuted : danger ? palette.danger : palette.textMuted;
  if (!danger && !disabled && tone) {
    if (tone === "danger") fg = palette.danger;
    else if (tone === "success") fg = palette.success;
    else if (tone === "warning") fg = palette.warning;
    else if (tone === "info") fg = palette.primaryStrong;
    else if (tone === "primary") fg = palette.primary;
  }

  const { scale, opacity, onPressIn, onPressOut } = usePressAnimation(disabled);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        if (!disabled) {
          triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <Animated.View style={[styles.iconButton, { opacity: disabled ? 0.5 : opacity, transform: [{ scale }] }]}>
        <MaterialCommunityIcons name={icon} size={19} color={fg} />
      </Animated.View>
    </Pressable>
  );
});

function TopAppBarIconRow({ onPress, label, children, palette, isPeriod }: { onPress: () => void; label: string; children: React.ReactNode; palette: ThemePalette; isPeriod: boolean }) {
  const { scale, opacity, onPressIn, onPressOut } = usePressAnimation();
  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} accessibilityRole="button" accessibilityLabel={label}>
      <Animated.View style={[isPeriod ? styles.topAppPeriodRow : styles.topAppShopRow, { transform: [{ scale }], opacity }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

function TopAppBarIconButton({ onPress, label, children, palette }: { onPress?: () => void; label: string; children: React.ReactNode; palette: ThemePalette }) {
  const { scale, opacity, onPressIn, onPressOut } = usePressAnimation();
  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} accessibilityRole="button" accessibilityLabel={label}>
      <Animated.View style={[styles.topAppIconBtn, { backgroundColor: palette.shellControl, borderColor: palette.shellBorder, transform: [{ scale }], opacity }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  metricCard: {
    flexBasis: "47.2%",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 96,
    borderRadius: adminRadii.card,
    borderWidth: 1,
    padding: adminSpacing.md,
    gap: adminSpacing.xs,
    justifyContent: "space-between",
  },
  metricCardFullWidth: {
    flexBasis: "100%",
  },
  metricHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: adminSpacing.xs,
  },
  metricHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: adminSpacing.xxs,
  },
  metricLabel: {
    ...adminTypography.caption,
  },
  metricValue: {
    ...adminTypography.metric,
  },
  metricNote: {
    ...adminTypography.body,
  },
  sectionCard: {
    marginTop: adminSpacing.sm,
    borderWidth: 1,
    borderRadius: adminRadii.card,
    padding: adminSpacing.md,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: adminSpacing.sm,
  },
  sectionHeaderText: {
    flex: 1,
    gap: adminSpacing.xxs,
  },
  sectionHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.xs,
  },
  sectionTitle: adminTypography.sectionTitle,
  sectionSubtitle: adminTypography.body,
  chevronWrap: {
    width: 32,
    height: 32,
    borderRadius: adminRadii.control,
    alignItems: "center",
    justifyContent: "center",
  },
  searchField: {
    minHeight: 48,
    borderRadius: adminRadii.control,
    borderWidth: 1,
    paddingHorizontal: adminSpacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.xs,
  },
  searchInput: {
    flex: 1,
    ...adminTypography.body,
  },
  chipButton: {
    minHeight: 44,
    borderRadius: adminRadii.pill,
    borderWidth: 1,
    paddingHorizontal: adminSpacing.md,
    paddingVertical: adminSpacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.xs,
  },
  chipText: adminTypography.bodyStrong,
  buttonBase: {
    minHeight: 48,
    borderRadius: adminRadii.control,
    paddingHorizontal: adminSpacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: adminSpacing.xs - 1,
  },
  buttonLabel: {
    ...adminTypography.bodyStrong,
    flexShrink: 1,
    textAlign: "center",
  },
  emptyCard: {
    borderRadius: adminRadii.card,
    borderWidth: 1,
    padding: adminSpacing.lg,
    gap: adminSpacing.sm,
    alignItems: "center",
  },
  emptyIconWrap: {
    width: 44,
    height: 44,
    borderRadius: adminRadii.icon,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    ...adminTypography.cardTitle,
    textAlign: "center",
  },
  emptySubtitle: {
    ...adminTypography.body,
    textAlign: "center",
  },
  inlineBanner: {
    borderWidth: 1,
    borderRadius: adminRadii.control,
    paddingHorizontal: adminSpacing.sm + 2,
    paddingVertical: adminSpacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.sm,
  },
  inlineBannerText: adminTypography.body,
  tabSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: adminSpacing.sm,
    marginBottom: adminSpacing.xxs,
  },
  tabSectionTitle: adminTypography.pageTitle,
  sectionBadge: {
    justifyContent: "center",
  },
  sectionBadgeText: {
    overflow: "hidden",
    borderRadius: adminRadii.pill,
    paddingHorizontal: adminSpacing.sm,
    paddingVertical: adminSpacing.xxs,
    ...adminTypography.badge,
  },
  sectionHint: adminTypography.body,
  toastContainer: {
    position: "absolute",
    top: adminSpacing.sm,
    left: adminSpacing.md,
    right: adminSpacing.md,
    zIndex: 50,
    borderRadius: adminRadii.control,
    paddingHorizontal: adminSpacing.sm + 2,
    paddingVertical: adminSpacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.sm,
  },
  toastText: {
    flex: 1,
    ...adminTypography.bodyStrong,
  },
  bottomNavDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    zIndex: 40,
  },
  bottomNavTrack: {
    paddingHorizontal: adminSpacing.xs,
    paddingTop: adminSpacing.xxs,
    paddingBottom: adminSpacing.xxs,
    alignItems: "stretch",
    minWidth: "100%",
  },
  bottomNavItemBase: {
    minWidth: BOTTOM_NAV_ITEM_MIN_WIDTH,
    maxWidth: 96,
    paddingHorizontal: adminSpacing.xxs,
  },
  bottomNavItemSurface: {
    minHeight: 52,
    borderRadius: adminRadii.control,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomNavItemContent: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: adminSpacing.xxs,
    paddingHorizontal: adminSpacing.xxs,
  },
  bottomNavIndicatorSlot: {
    width: "100%",
    height: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomNavIndicator: {
    width: 28,
    height: 3,
    borderRadius: 1.5,
  },
  bottomNavIndicatorSpacer: {
    width: 28,
    height: 3,
  },
  bottomNavLabel: {
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.1,
    textAlign: "center",
    maxWidth: 72,
  },
  topAppBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: adminSpacing.lg,
    paddingBottom: adminSpacing.sm,
    borderBottomWidth: 1,
    zIndex: 20,
  },
  topAppLeft: {
    flex: 1,
    gap: adminSpacing.xxs,
    marginRight: adminSpacing.sm,
  },
  topAppShopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.xs - 2,
  },
  topAppShopName: adminTypography.pageTitle,
  topAppPeriodRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.xxs + 1,
  },
  topAppPeriodText: adminTypography.bodyStrong,
  topAppActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.sm,
  },
  topAppIconBtn: {
    width: 40,
    height: 40,
    borderRadius: adminRadii.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: adminRadii.pill,
  },
  actionButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  actionButtonCompact: {
    minHeight: 36,
    paddingHorizontal: 12,
    gap: 6,
    borderRadius: 6,
  },
  actionText: {
    ...adminTypography.bodyStrong,
    fontSize: 13,
  },
  actionTextCompact: {
    fontSize: 12,
  },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
