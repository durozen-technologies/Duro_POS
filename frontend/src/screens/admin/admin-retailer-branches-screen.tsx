import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { toApiError } from "@/api/client";
import {
  fetchRetailerBranchAllocations,
  syncRetailerBranchAllocations,
} from "@/api/retailers";
import type { AdminRetailerBranchesScreenProps } from "@/navigation/types";
import type { RetailerBranchAllocationRead, UUID } from "@/types/api";

import { adminRadii, adminSpacing, adminTypography } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { EmptyStateCard } from "./components/admin-dashboard-primitives";
import { useAdminTheme } from "./use-admin-theme";

function branchLabel(count: number) {
  return count === 1 ? "1 branch" : `${count} branches`;
}

export function AdminRetailerBranchesScreen({
  navigation,
  route,
}: AdminRetailerBranchesScreenProps) {
  const { retailerId, retailerName, requireSelection = false } = route.params;
  const { palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<RetailerBranchAllocationRead[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<UUID>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const allocations = await fetchRetailerBranchAllocations(retailerId);
      setRows(allocations);
      setSelectedIds(
        new Set(
          allocations.filter((row) => row.is_allocated).map((row) => row.shop_id),
        ),
      );
      setError(null);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [retailerId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const selectedCount = selectedIds.size;
  const summary = useMemo(() => {
    if (selectedCount === 0) {
      return "Not assigned to any branch";
    }
    return `Assigned to ${branchLabel(selectedCount)}`;
  }, [selectedCount]);

  const toggleShop = useCallback((shopId: UUID) => {
    triggerHaptic();
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(shopId)) {
        next.delete(shopId);
      } else {
        next.add(shopId);
      }
      return next;
    });
  }, []);

  const selectAllActive = useCallback(() => {
    triggerHaptic();
    setSelectedIds(
      new Set(rows.filter((row) => row.shop_is_active).map((row) => row.shop_id)),
    );
  }, [rows]);

  const clearAll = useCallback(() => {
    triggerHaptic();
    setSelectedIds(new Set());
  }, []);

  const save = useCallback(async () => {
    if (requireSelection && selectedIds.size === 0) {
      Alert.alert("Select branches", "Choose at least one branch for this retailer.");
      return;
    }
    setSaving(true);
    try {
      await syncRetailerBranchAllocations(retailerId, Array.from(selectedIds));
      triggerHaptic();
      navigation.goBack();
    } catch (err) {
      Alert.alert("Save failed", toApiError(err).message);
    } finally {
      setSaving(false);
    }
  }, [navigation, requireSelection, retailerId, selectedIds]);

  const renderRow = useCallback(
    ({ item }: { item: RetailerBranchAllocationRead }) => {
      const selected = selectedIds.has(item.shop_id);
      return (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={`${item.shop_name}, ${item.shop_is_active ? "active" : "paused"}`}
          onPress={() => toggleShop(item.shop_id)}
          style={[
            styles.row,
            {
              backgroundColor: selected ? palette.primarySoft : palette.card,
              borderColor: selected ? palette.primary : palette.border,
            },
          ]}
        >
          <View
            style={[
              styles.rowIcon,
              { backgroundColor: selected ? palette.primary : palette.surfaceMuted },
            ]}
          >
            <MaterialCommunityIcons
              name="storefront-outline"
              size={18}
              color={selected ? palette.onPrimary : palette.textMuted}
            />
          </View>
          <View style={styles.rowText}>
            <Text style={[adminTypography.section, { color: palette.textPrimary }]} numberOfLines={1}>
              {item.shop_name}
            </Text>
            <Text style={[adminTypography.body, { color: palette.textMuted, marginTop: 2 }]}>
              {item.shop_is_active ? "Active branch" : "Paused branch"}
            </Text>
          </View>
          <MaterialCommunityIcons
            name={selected ? "check-circle" : "checkbox-blank-circle-outline"}
            size={22}
            color={selected ? palette.primary : palette.textMuted}
          />
        </Pressable>
      );
    },
    [palette, selectedIds, toggleShop],
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={["left", "right"]}>
      <StatusBar style="light" />
      <View
        style={[
          styles.topBar,
          {
            backgroundColor: palette.shell,
            borderBottomColor: palette.shellBorder,
            paddingTop: Math.max(insets.top - 8, 0),
          },
        ]}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => navigation.goBack()} hitSlop={12}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <View style={styles.topBarText}>
          <Text style={[adminTypography.pageTitle, { color: palette.onShell }]} numberOfLines={1}>
            Assign branches
          </Text>
          <Text style={[adminTypography.body, { color: palette.onShellMuted }]} numberOfLines={1}>
            {retailerName}
          </Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={palette.primary} style={styles.loader} />
      ) : error ? (
        <EmptyStateCard
          title="Unable to load branches"
          subtitle={error}
          actionLabel="Retry"
          onAction={() => void load()}
          palette={palette}
          icon="alert-circle-outline"
        />
      ) : rows.length === 0 ? (
        <EmptyStateCard
          title="No branches yet"
          subtitle="Create a shop branch before assigning this retailer."
          palette={palette}
          icon="store-off-outline"
        />
      ) : (
        <>
          <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[adminTypography.section, { color: palette.textPrimary }]}>{summary}</Text>
            <Text style={[adminTypography.body, { color: palette.textMuted, marginTop: 4 }]}>
              Only assigned branches can bill this retailer at the shop counter.
            </Text>
            <View style={styles.summaryActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Select all active branches"
                onPress={selectAllActive}
                style={[styles.summaryButton, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}
              >
                <Text style={{ color: palette.textPrimary, fontWeight: "700", fontSize: 13 }}>All active</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear branch selection"
                onPress={clearAll}
                style={[styles.summaryButton, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}
              >
                <Text style={{ color: palette.textPrimary, fontWeight: "700", fontSize: 13 }}>Clear</Text>
              </Pressable>
            </View>
          </View>

          <FlatList
            data={rows}
            keyExtractor={(item) => item.shop_id}
            renderItem={renderRow}
            contentContainerStyle={{ padding: adminSpacing.md, paddingBottom: 96 + insets.bottom, gap: 10 }}
            showsVerticalScrollIndicator={false}
          />

          <View
            style={[
              styles.footer,
              {
                backgroundColor: palette.background,
                borderTopColor: palette.border,
                paddingBottom: Math.max(insets.bottom, 12),
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save branch assignments"
              disabled={saving}
              onPress={() => void save()}
              style={[
                styles.saveButton,
                { backgroundColor: palette.primary, opacity: saving ? 0.72 : 1 },
              ]}
            >
              {saving ? (
                <ActivityIndicator color={palette.onPrimary} />
              ) : (
                <Text style={{ color: palette.onPrimary, fontWeight: "800", fontSize: 15 }}>
                  Save assignments
                </Text>
              )}
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: adminSpacing.sm,
    paddingHorizontal: adminSpacing.md,
    paddingBottom: adminSpacing.sm,
    borderBottomWidth: 1,
  },
  topBarText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  loader: {
    marginTop: 24,
  },
  summaryCard: {
    marginHorizontal: adminSpacing.md,
    marginTop: adminSpacing.md,
    padding: adminSpacing.md,
    borderRadius: adminRadii.card,
    borderWidth: 1,
  },
  summaryActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  summaryButton: {
    borderRadius: adminRadii.control,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: adminRadii.card,
    borderWidth: 1,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: adminSpacing.md,
    paddingTop: 12,
  },
  saveButton: {
    minHeight: 48,
    borderRadius: adminRadii.card,
    alignItems: "center",
    justifyContent: "center",
  },
});
