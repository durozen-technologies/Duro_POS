import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { SkeletonList, SkeletonLoadingCaption } from "@/components/ui/skeleton";

import {
  adminElevation,
  adminPressOpacity,
  adminPressScale,
  adminRadii,
  adminSpacing,
  adminTypography,
  type ThemePalette,
} from "../admin-dashboard-theme";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

type AdminNavItem = {
  key: string;
  label: string;
  icon: IconName;
};

export function AdminScreen({
  children,
  palette,
  scroll = true,
  refreshControl,
  bottomPadding = 96,
}: {
  children: ReactNode;
  palette: ThemePalette;
  scroll?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  bottomPadding?: number;
}) {
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView edges={["left", "right"]} style={[styles.screen, { backgroundColor: palette.background }]}>
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={refreshControl}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: bottomPadding + insets.bottom },
          ]}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={styles.flex}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export const AdminCard = memo(function AdminCard({
  children,
  palette,
  style,
}: {
  children: ReactNode;
  palette: ThemePalette;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.card, borderColor: palette.border },
        style,
      ]}
    >
      {children}
    </View>
  );
});

export const AdminSectionHeader = memo(function AdminSectionHeader({
  title,
  subtitle,
  badge,
  palette,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  palette: ThemePalette;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderText}>
        <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>{title}</Text>
        {subtitle ? <Text style={[styles.sectionSubtitle, { color: palette.textMuted }]}>{subtitle}</Text> : null}
      </View>
      {badge ? (
        <View style={[styles.badge, { backgroundColor: palette.primarySoft }]}>
          <Text style={[styles.badgeText, { color: palette.primaryStrong }]}>{badge}</Text>
        </View>
      ) : null}
    </View>
  );
});

export const AdminTopBar = memo(function AdminTopBar({
  title,
  subtitle,
  palette,
  leftAction,
  rightAction,
}: {
  title: string;
  subtitle?: string;
  palette: ThemePalette;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
}) {
  return (
    <View style={[styles.topBar, { backgroundColor: palette.background, borderBottomColor: palette.border }]}>
      {leftAction}
      <View style={styles.topBarText}>
        <Text numberOfLines={1} style={[styles.topBarTitle, { color: palette.textPrimary }]}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={[styles.topBarSubtitle, { color: palette.textMuted }]}>{subtitle}</Text> : null}
      </View>
      {rightAction}
    </View>
  );
});

export const AdminBottomNav = memo(function AdminBottomNav({
  items,
  activeKey,
  palette,
  bottomOffset,
  onSelect,
}: {
  items: AdminNavItem[];
  activeKey: string;
  palette: ThemePalette;
  bottomOffset: number;
  onSelect: (key: string) => void;
}) {
  return (
    <View
      style={[
        styles.bottomNav,
        adminElevation(2),
        { bottom: bottomOffset + adminSpacing.sm, backgroundColor: palette.navBackdrop },
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
            onPress={() => onSelect(item.key)}
            style={({ pressed }) => [
              styles.bottomNavItem,
              active && { backgroundColor: palette.primarySoft },
              pressed && { opacity: adminPressOpacity, transform: [{ scale: adminPressScale }] },
            ]}
          >
            <MaterialCommunityIcons name={item.icon} size={20} color={active ? palette.primary : palette.textMuted} />
            {active ? (
              <Text numberOfLines={1} style={[styles.bottomNavText, { color: palette.primaryStrong }]}>{item.label}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
});

export const AdminSegmentedTabs = memo(function AdminSegmentedTabs<TValue extends string>({
  items,
  activeValue,
  palette,
  onChange,
  scrollable = false,
}: {
  items: { value: TValue; label: string; icon?: IconName }[];
  activeValue: TValue;
  palette: ThemePalette;
  onChange: (value: TValue) => void;
  scrollable?: boolean;
}) {
  const content = items.map((item) => {
    const active = item.value === activeValue;
    return (
      <Pressable
        key={item.value}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={() => onChange(item.value)}
        style={[
          styles.segmentedTab,
          !scrollable && { flex: 1 },
          scrollable && { paddingHorizontal: adminSpacing.md },
          active && { backgroundColor: palette.card, borderColor: palette.border }
        ]}
      >
        {item.icon ? (
          <MaterialCommunityIcons name={item.icon} size={16} color={active ? palette.primary : palette.textMuted} />
        ) : null}
        <Text numberOfLines={1} style={[styles.segmentedTabText, { color: active ? palette.primaryStrong : palette.textMuted }]}>
          {item.label}
        </Text>
      </Pressable>
    );
  });

  if (scrollable) {
    return (
      <View style={[styles.segmentedTabs, { backgroundColor: palette.surfaceMuted, borderColor: palette.border, padding: 0, gap: 0 }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ padding: adminSpacing.xs, gap: adminSpacing.xs }}
        >
          {content}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.segmentedTabs, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
      {content}
    </View>
  );
});

export const AdminSearchBar = memo(function AdminSearchBar({
  value,
  onChangeText,
  placeholder,
  palette,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  palette: ThemePalette;
}) {
  return (
    <View style={[styles.search, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <MaterialCommunityIcons name="magnify" size={18} color={palette.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        style={[styles.searchInput, { color: palette.textPrimary }]}
        returnKeyType="search"
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChangeText("")}>
          <MaterialCommunityIcons name="close-circle" size={18} color={palette.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
});

export const AdminIconButton = memo(function AdminIconButton({
  icon,
  onPress,
  palette,
  accessibilityLabel,
  disabled = false,
}: {
  icon: IconName;
  onPress: () => void;
  palette: ThemePalette;
  accessibilityLabel: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.iconButton, { backgroundColor: palette.surfaceMuted, borderColor: palette.border, opacity: disabled ? 0.55 : 1 }]}
    >
      <MaterialCommunityIcons name={icon} size={20} color={palette.textPrimary} />
    </Pressable>
  );
});

export const AdminPrimaryButton = memo(function AdminPrimaryButton({
  label,
  icon,
  onPress,
  palette,
  loading = false,
  disabled = false,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  palette: ThemePalette;
  loading?: boolean;
  disabled?: boolean;
}) {
  const blocked = loading || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        {
          backgroundColor: palette.primary,
          borderColor: palette.primary,
          opacity: disabled ? 0.55 : pressed ? adminPressOpacity : 1,
          transform: [{ scale: pressed && !blocked ? adminPressScale : 1 }],
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.onPrimary} />
      ) : (
        <>
          {icon ? <MaterialCommunityIcons name={icon} size={17} color={palette.onPrimary} /> : null}
          <Text numberOfLines={1} style={[styles.primaryButtonText, { color: palette.onPrimary }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
});

export const AdminEmptyState = memo(function AdminEmptyState({
  title,
  message,
  icon,
  palette,
}: {
  title: string;
  message: string;
  icon: IconName;
  palette: ThemePalette;
}) {
  return (
    <AdminCard palette={palette} style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: palette.primarySoft }]}>
        <MaterialCommunityIcons name={icon} size={24} color={palette.primary} />
      </View>
      <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>{title}</Text>
      <Text style={[styles.emptyMessage, { color: palette.textMuted }]}>{message}</Text>
    </AdminCard>
  );
});

export function AdminLoadingState({ label, palette }: { label: string; palette: ThemePalette }) {
  const tone = {
    base: palette.card,
    highlight: palette.surfaceMuted,
    border: palette.border,
  };

  return (
    <View style={styles.loading}>
      <SkeletonList rows={4} tone={tone} label={label} />
      <SkeletonLoadingCaption label={label} />
    </View>
  );
}

export function AdminErrorBanner({
  message,
  palette,
  onRetry,
}: {
  message: string | null;
  palette: ThemePalette;
  onRetry?: () => void;
}) {
  if (!message) {
    return null;
  }

  return (
    <View style={[styles.errorBanner, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
      <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
      <Text style={[styles.errorText, { color: palette.danger }]}>{message}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text style={[styles.errorAction, { color: palette.danger }]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  scrollContent: {
    padding: adminSpacing.lg,
    gap: adminSpacing.md,
  },
  card: {
    borderWidth: 1,
    borderRadius: adminRadii.card,
    padding: adminSpacing.md,
    gap: adminSpacing.sm,
  },
  topBar: {
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: adminSpacing.lg,
    paddingVertical: adminSpacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.md,
  },
  topBarText: {
    flex: 1,
    minWidth: 0,
  },
  topBarTitle: adminTypography.pageTitle,
  topBarSubtitle: adminTypography.caption,
  bottomNav: {
    position: "absolute",
    left: adminSpacing.md,
    right: adminSpacing.md,
    minHeight: 58,
    borderRadius: adminRadii.card,
    padding: adminSpacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bottomNavItem: {
    minWidth: 0,
    flex: 1,
    minHeight: 48,
    borderRadius: adminRadii.control,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  bottomNavText: {
    maxWidth: "100%",
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  segmentedTabs: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: adminRadii.control,
    padding: adminSpacing.xs,
    flexDirection: "row",
    gap: adminSpacing.xs,
  },
  segmentedTab: {
    minHeight: 38,
    borderRadius: adminRadii.control,
    borderWidth: 1,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: adminSpacing.sm,
  },
  segmentedTabText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    flexShrink: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: adminSpacing.md,
  },
  sectionHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sectionTitle: adminTypography.sectionTitle,
  sectionSubtitle: adminTypography.body,
  badge: {
    minHeight: 24,
    borderRadius: adminRadii.pill,
    paddingHorizontal: adminSpacing.sm,
    justifyContent: "center",
  },
  badgeText: adminTypography.badge,
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: adminRadii.control,
    paddingHorizontal: adminSpacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.sm,
  },
  searchInput: {
    flex: 1,
    minHeight: 40,
    ...adminTypography.body,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderRadius: adminRadii.icon,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: adminRadii.control,
    paddingHorizontal: adminSpacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: adminSpacing.sm,
  },
  primaryButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    flexShrink: 1,
  },
  empty: {
    alignItems: "flex-start",
    padding: adminSpacing.lg,
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: adminRadii.icon,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: adminTypography.cardTitle,
  emptyMessage: adminTypography.body,
  loading: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: adminSpacing.sm,
  },
  loadingText: adminTypography.body,
  errorBanner: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: adminRadii.control,
    paddingHorizontal: adminSpacing.md,
    paddingVertical: adminSpacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.sm,
  },
  errorText: {
    flex: 1,
    ...adminTypography.body,
  },
  errorAction: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
});
