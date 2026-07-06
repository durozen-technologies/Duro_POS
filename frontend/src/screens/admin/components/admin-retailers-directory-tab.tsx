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

import { fetchRetailers } from "@/api/retailers";
import { toApiError, formatApiErrorMessage } from "@/api/client";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { RetailerRead } from "@/types/api";
import { formatCurrency } from "@/utils/format";

import { adminRadii, adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import {
  ChipButton,
  EmptyStateCard,
  SearchField,
  ActionButton,
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
  const balance = Number(item.outstanding_balance ?? 0);
  const hasBalance = balance > 0;

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
            {(item.branch_names ?? []).length > 0 ? (
              <Text style={[adminTypography.body, { color: palette.textMuted, marginTop: 2 }]} numberOfLines={1}>
                {item.branch_names!.join(" · ")}
              </Text>
            ) : (
              <Text style={[adminTypography.body, { color: palette.textMuted, marginTop: 2 }]} numberOfLines={1}>
                No branches assigned
              </Text>
            )}
            {hasBalance ? (
              <Text style={[adminTypography.body, { color: palette.warning, marginTop: 3, fontWeight: "700" }]} numberOfLines={1}>
                Balance due {formatCurrency(item.outstanding_balance)}
              </Text>
            ) : null}
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
  const [retailers, setRetailers] = useState<RetailerRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const debouncedSearch = useDebouncedValue(search, 250);

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
      setError(formatApiErrorMessage(err));
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

  return (
    <View style={styles.container}>
      <View style={{ flexDirection: "row", gap: adminSpacing.sm, alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder="Search retailers"
            palette={palette}
            accessibilityLabel="Search retailers"
          />
        </View>
        <ActionButton
          icon="plus"
          label="Add"
          tone="success"
          palette={palette}
          active
          onPress={() => {
            triggerHaptic();
            onCreateRetailer();
          }}
        />
      </View>

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
