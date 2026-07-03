import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchRetailers } from "@/api/retailers";
import { toApiError } from "@/api/client";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { RetailerRead } from "@/types/api";

import { adminRadii, adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import {
  ChipButton,
  EmptyStateCard,
  SearchField,
  usePressAnimation,
} from "./admin-dashboard-primitives";

type RetailerRowProps = {
  item: RetailerRead;
  onPress: (item: RetailerRead) => void;
  palette: ThemePalette;
};

const RetailerRow = memo(function RetailerRow({ item, onPress, palette }: RetailerRowProps) {
  const { scale, opacity, onPressIn, onPressOut } = usePressAnimation();
  const statusBg = item.is_active ? palette.successSoft : palette.surfaceMuted;
  const statusFg = item.is_active ? palette.success : palette.textMuted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}${item.phone ? `, ${item.phone}` : ""}, ${item.is_active ? "Active" : "Paused"}`}
      onPress={() => {
        triggerHaptic();
        onPress(item);
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <Animated.View
        style={[
          styles.row,
          {
            backgroundColor: palette.card,
            borderColor: palette.border,
            opacity,
            transform: [{ scale }],
          },
        ]}
      >
        <View style={styles.rowMain}>
          <View style={styles.rowText}>
            <Text style={[adminTypography.section, { color: palette.textPrimary }]} numberOfLines={1}>
              {item.name}
            </Text>
            {item.phone ? (
              <Text style={[adminTypography.body, { color: palette.textMuted, marginTop: 2 }]} numberOfLines={1}>
                {item.phone}
              </Text>
            ) : null}
            <Text style={[adminTypography.body, { color: palette.textMuted, marginTop: 2 }]} numberOfLines={1}>
              {(item.allocated_shop_count ?? 0) === 0
                ? "No branches assigned"
                : `${item.allocated_shop_count} branch${item.allocated_shop_count === 1 ? "" : "es"}`}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
            <Text style={[adminTypography.badge, { color: statusFg }]}>
              {item.is_active ? "Active" : "Paused"}
            </Text>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
});

type AdminRetailersDirectoryTabProps = {
  palette: ThemePalette;
  refreshNonce?: number;
  onRefreshComplete?: () => void;
  onOpenRetailer: (retailer: RetailerRead) => void;
  onCreateRetailer: () => void;
};

export const AdminRetailersDirectoryTab = memo(function AdminRetailersDirectoryTab({
  palette,
  refreshNonce = 0,
  onRefreshComplete,
  onOpenRetailer,
  onCreateRetailer,
}: AdminRetailersDirectoryTabProps) {
  const insets = useSafeAreaInsets();
  const [retailers, setRetailers] = useState<RetailerRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const debouncedSearch = useDebouncedValue(search, 250);

  const fabAnim = useRef(new Animated.Value(1)).current;
  const onFabPressIn = useCallback(() => {
    Animated.timing(fabAnim, {
      toValue: 0.93,
      duration: 100,
      easing: Easing.bezier(0.25, 1, 0.5, 1),
      useNativeDriver: true,
    }).start();
  }, [fabAnim]);
  const onFabPressOut = useCallback(() => {
    Animated.timing(fabAnim, {
      toValue: 1,
      duration: 200,
      easing: Easing.bezier(0.25, 1, 0.5, 1),
      useNativeDriver: true,
    }).start();
  }, [fabAnim]);

  const loadRetailers = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const page = await fetchRetailers({
        q: debouncedSearch || undefined,
        active: activeOnly ? true : undefined,
        page_size: 100,
      });
      setRetailers(page.items);
      setError(null);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
      if (isRefresh) {
        onRefreshComplete?.();
      }
    }
  }, [activeOnly, debouncedSearch, onRefreshComplete]);

  useFocusEffect(useCallback(() => { void loadRetailers(); }, [loadRetailers]));

  useEffect(() => {
    if (refreshNonce > 0) {
      void loadRetailers(true);
    }
  }, [loadRetailers, refreshNonce]);

  const fabStyle = useMemo(
    () => ({
      position: "absolute" as const,
      right: adminSpacing.lg,
      bottom: insets.bottom + adminSpacing.md,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: palette.primary,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    }),
    [insets.bottom, palette.primary],
  );

  return (
    <View style={styles.container}>
      <SearchField
        value={search}
        onChangeText={setSearch}
        placeholder="Search retailers"
        palette={palette}
        accessibilityLabel="Search retailers"
      />

      <View style={styles.filterRow}>
        <ChipButton
          label="Active"
          active={activeOnly}
          onPress={() => setActiveOnly(true)}
          palette={palette}
          icon="check-circle-outline"
        />
        <ChipButton
          label="All"
          active={!activeOnly}
          onPress={() => setActiveOnly(false)}
          palette={palette}
          icon="store-outline"
        />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <MaterialCommunityIcons name="store-outline" size={32} color={palette.border} />
          <Text style={[styles.loadingLabel, { color: palette.textMuted }]}>Loading retailers…</Text>
        </View>
      ) : error ? (
        <EmptyStateCard
          title="Unable to load retailers"
          subtitle={error}
          actionLabel="Retry"
          onAction={() => void loadRetailers()}
          palette={palette}
          icon="store-alert"
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={retailers}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadRetailers(true)}
              tintColor={palette.primary}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: adminSpacing.xs }} />}
          ListEmptyComponent={
            <EmptyStateCard
              title="No retailers yet"
              subtitle="Create a retailer to set wholesale prices and track balances."
              actionLabel="Add retailer"
              onAction={onCreateRetailer}
              palette={palette}
              icon="store-outline"
            />
          }
          renderItem={({ item }) => (
            <RetailerRow item={item} onPress={onOpenRetailer} palette={palette} />
          )}
        />
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add retailer"
        onPress={() => {
          triggerHaptic();
          onCreateRetailer();
        }}
        onPressIn={onFabPressIn}
        onPressOut={onFabPressOut}
      >
        <Animated.View style={[fabStyle, { transform: [{ scale: fabAnim }] }]}>
          <MaterialCommunityIcons name="plus" size={28} color={palette.onPrimary} />
        </Animated.View>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filterRow: {
    flexDirection: "row",
    gap: adminSpacing.xs,
    marginTop: adminSpacing.xs,
    marginBottom: adminSpacing.sm,
  },
  row: {
    borderRadius: adminRadii.card,
    borderWidth: 1,
    padding: adminSpacing.md,
  },
  rowMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.xs,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  statusBadge: {
    borderRadius: adminRadii.pill,
    paddingHorizontal: adminSpacing.xs,
    paddingVertical: 3,
    flexShrink: 0,
  },
  listContent: {
    paddingBottom: 88,
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 56,
    gap: adminSpacing.sm,
  },
  loadingLabel: {
    ...adminTypography.body,
  },
});
