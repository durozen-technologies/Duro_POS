import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { memo, useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { fetchRetailers } from "@/api/retailers";
import { toApiError } from "@/api/client";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { RetailerRead } from "@/types/api";

import { adminRadii, adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import { EmptyStateCard, SearchField, SectionHint } from "./admin-dashboard-primitives";

type AdminRetailersItemsTabProps = {
  palette: ThemePalette;
  refreshNonce?: number;
  onRefreshComplete?: () => void;
  onAssignItems: (retailer: RetailerRead) => void;
};

export const AdminRetailersItemsTab = memo(function AdminRetailersItemsTab({
  palette,
  refreshNonce = 0,
  onRefreshComplete,
  onAssignItems,
}: AdminRetailersItemsTabProps) {
  const [retailers, setRetailers] = useState<RetailerRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const page = await fetchRetailers({
        q: debouncedSearch || undefined,
        active: true,
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
  }, [debouncedSearch, onRefreshComplete]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    if (refreshNonce > 0) {
      void load(true);
    }
  }, [load, refreshNonce]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <MaterialCommunityIcons name="tag-multiple-outline" size={32} color={palette.border} />
        <Text style={[adminTypography.body, { color: palette.textMuted, marginTop: adminSpacing.sm }]}>
          Loading retailers…
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <EmptyStateCard
        title="Unable to load retailers"
        subtitle={error}
        actionLabel="Retry"
        onAction={() => void load()}
        palette={palette}
        icon="store-alert"
      />
    );
  }

  return (
    <View style={styles.container}>
      <SectionHint
        text="Select a retailer to map catalogue items and set wholesale prices for shop billing."
        palette={palette}
      />
      <SearchField
        value={search}
        onChangeText={setSearch}
        placeholder="Search active retailers"
        palette={palette}
        accessibilityLabel="Search retailers for item assignment"
      />
      <FlatList
        style={{ flex: 1 }}
        data={retailers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={palette.primary}
          />
        }
        ItemSeparatorComponent={() => <View style={{ height: adminSpacing.xs }} />}
        ListEmptyComponent={
          <EmptyStateCard
            title="No active retailers"
            subtitle="Create a retailer first, then assign item prices here."
            palette={palette}
            icon="tag-off-outline"
          />
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Assign items for ${item.name}`}
            onPress={() => {
              triggerHaptic();
              onAssignItems(item);
            }}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: palette.card,
                borderColor: palette.border,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            <View style={styles.rowMain}>
              <View style={[styles.iconWrap, { backgroundColor: palette.primarySoft }]}>
                <MaterialCommunityIcons name="tag-outline" size={20} color={palette.primary} />
              </View>
              <View style={styles.rowText}>
                <Text style={[adminTypography.section, { color: palette.textPrimary }]} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.phone ? (
                  <Text style={[adminTypography.body, { color: palette.textMuted, marginTop: 2 }]} numberOfLines={1}>
                    {item.phone}
                  </Text>
                ) : null}
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={palette.textMuted} />
            </View>
          </Pressable>
        )}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: adminSpacing.sm,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 48,
  },
  listContent: {
    paddingBottom: adminSpacing.lg,
  },
  row: {
    borderRadius: adminRadii.card,
    borderWidth: 1,
    padding: adminSpacing.md,
  },
  rowMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.sm,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: adminRadii.control,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
});
