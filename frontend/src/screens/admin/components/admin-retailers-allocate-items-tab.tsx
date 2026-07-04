import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toApiError } from "@/api/client";
import {
  fetchRetailerItemAllocations,
  fetchRetailers,
  syncRetailerItemPrices,
} from "@/api/retailers";
import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type {
  RetailerItemAllocationRead,
  RetailerItemPriceInput,
  RetailerRead,
  UUID,
} from "@/types/api";
import { getItemThumbnailUri } from "@/utils/item-images";

import { adminRadii, adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import { ChipButton, EmptyStateCard, SearchField, SectionHint } from "./admin-dashboard-primitives";

type ItemFilter = "all" | "allocated" | "available";

type AllocationDraft = {
  item_id: UUID;
  item_name: string;
  image_thumb_path?: string | null;
  image_path?: string | null;
  price_per_unit: string;
  billing_price?: string | null;
};

type AdminRetailersAllocateItemsTabProps = {
  palette: ThemePalette;
  refreshNonce?: number;
  onRefreshComplete?: () => void;
  initialRetailerId?: UUID | null;
};

function defaultWholesalePrice(item: RetailerItemAllocationRead): string {
  const price = item.billing_price?.trim();
  return price && Number(price) > 0 ? price : "";
}

export const AdminRetailersAllocateItemsTab = memo(function AdminRetailersAllocateItemsTab({
  palette,
  refreshNonce = 0,
  onRefreshComplete,
  initialRetailerId = null,
}: AdminRetailersAllocateItemsTabProps) {
  const insets = useSafeAreaInsets();
  const [retailers, setRetailers] = useState<RetailerRead[]>([]);
  const [selectedRetailerId, setSelectedRetailerId] = useState<UUID | null>(initialRetailerId);
  const [catalogueItems, setCatalogueItems] = useState<RetailerItemAllocationRead[]>([]);
  const [allocations, setAllocations] = useState<Map<UUID, AllocationDraft>>(new Map());
  const [loadingRetailers, setLoadingRetailers] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ItemFilter>("all");
  const [retailerPickerOpen, setRetailerPickerOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<UUID>>(new Set());
  const [dirty, setDirty] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 250);

  const selectedRetailer = useMemo(
    () => retailers.find((row) => row.id === selectedRetailerId) ?? null,
    [retailers, selectedRetailerId],
  );

  const loadRetailers = useCallback(async () => {
    setLoadingRetailers(true);
    try {
      const page = await fetchRetailers({ active: true, page_size: 100 });
      setRetailers(page.items);
      setSelectedRetailerId((current) => {
        if (current && page.items.some((row) => row.id === current)) {
          return current;
        }
        if (initialRetailerId && page.items.some((row) => row.id === initialRetailerId)) {
          return initialRetailerId;
        }
        return page.items[0]?.id ?? null;
      });
      setError(null);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setLoadingRetailers(false);
    }
  }, [initialRetailerId]);

  const loadItems = useCallback(
    async (isRefresh = false) => {
      if (!selectedRetailerId) {
        setCatalogueItems([]);
        setAllocations(new Map());
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoadingItems(true);
      try {
        const response = await fetchRetailerItemAllocations(selectedRetailerId, {
          q: debouncedSearch || undefined,
          limit: 200,
        });
        const nextAllocations = new Map<UUID, AllocationDraft>();
        for (const item of response.items) {
          if (!item.is_allocated || !item.price_per_unit) continue;
          nextAllocations.set(item.item_id, {
            item_id: item.item_id,
            item_name: item.item_name,
            image_thumb_path: item.image_thumb_path,
            image_path: item.image_path,
            price_per_unit: item.price_per_unit,
            billing_price: item.billing_price,
          });
        }

        setCatalogueItems(response.items);
        setAllocations(nextAllocations);
        setPendingIds(new Set());
        setDirty(false);
        setError(null);
      } catch (err) {
        setError(toApiError(err).message);
      } finally {
        setLoadingItems(false);
        setRefreshing(false);
        if (isRefresh) {
          onRefreshComplete?.();
        }
      }
    },
    [debouncedSearch, onRefreshComplete, selectedRetailerId],
  );

  useFocusEffect(
    useCallback(() => {
      void loadRetailers();
    }, [loadRetailers]),
  );

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (refreshNonce > 0) {
      void loadRetailers();
      void loadItems(true);
    }
  }, [loadItems, loadRetailers, refreshNonce]);

  useEffect(() => {
    if (initialRetailerId) {
      setSelectedRetailerId(initialRetailerId);
    }
  }, [initialRetailerId]);

  const filteredItems = useMemo(() => {
    return catalogueItems.filter((item) => {
      const allocated = allocations.has(item.item_id);
      if (filter === "allocated") return allocated;
      if (filter === "available") return !allocated;
      return true;
    });
  }, [allocations, catalogueItems, filter]);

  const allocatedCount = allocations.size;
  const pendingAddCount = pendingIds.size;

  const markDirty = useCallback(() => setDirty(true), []);

  const togglePending = useCallback((itemId: UUID) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const allocatePending = useCallback(() => {
    if (pendingAddCount === 0) return;
    triggerHaptic();
    setAllocations((current) => {
      const next = new Map(current);
      for (const itemId of pendingIds) {
        if (next.has(itemId)) continue;
        const item = catalogueItems.find((row) => row.item_id === itemId);
        if (!item) continue;
        next.set(itemId, {
          item_id: item.item_id,
          item_name: item.item_name,
          image_thumb_path: item.image_thumb_path,
          image_path: item.image_path,
          price_per_unit: defaultWholesalePrice(item),
          billing_price: item.billing_price,
        });
      }
      return next;
    });
    setPendingIds(new Set());
    markDirty();
  }, [catalogueItems, markDirty, pendingAddCount, pendingIds]);

  const toggleAllocated = useCallback(
    (item: RetailerItemAllocationRead) => {
      triggerHaptic();
      setAllocations((current) => {
        const next = new Map(current);
        if (next.has(item.item_id)) {
          next.delete(item.item_id);
          setPendingIds((pending) => {
            const copy = new Set(pending);
            copy.delete(item.item_id);
            return copy;
          });
        } else {
          next.set(item.item_id, {
            item_id: item.item_id,
            item_name: item.item_name,
            image_thumb_path: item.image_thumb_path,
            image_path: item.image_path,
            price_per_unit: defaultWholesalePrice(item),
            billing_price: item.billing_price,
          });
        }
        return next;
      });
      markDirty();
    },
    [markDirty],
  );

  const updatePrice = useCallback(
    (itemId: UUID, price: string) => {
      setAllocations((current) => {
        const row = current.get(itemId);
        if (!row) return current;
        const next = new Map(current);
        next.set(itemId, { ...row, price_per_unit: price });
        return next;
      });
      markDirty();
    },
    [markDirty],
  );

  const save = useCallback(async () => {
    if (!selectedRetailerId) return;
    const payload: RetailerItemPriceInput[] = [];
    for (const row of allocations.values()) {
      const price = row.price_per_unit.trim();
      if (!price || Number(price) <= 0) {
        Alert.alert("Invalid price", `Set a wholesale price for ${row.item_name}.`);
        return;
      }
      payload.push({
        item_id: row.item_id,
        price_per_unit: price,
        is_active: true,
      });
    }
    setSaving(true);
    try {
      await syncRetailerItemPrices(selectedRetailerId, payload);
      triggerHaptic();
      setDirty(false);
      await loadItems();
      Alert.alert("Saved", `${payload.length} item${payload.length === 1 ? "" : "s"} allocated.`);
    } catch (err) {
      Alert.alert("Save failed", toApiError(err).message);
    } finally {
      setSaving(false);
    }
  }, [allocations, loadItems, selectedRetailerId]);

  const renderRetailerPicker = () => (
    <Modal visible={retailerPickerOpen} transparent animationType="fade" onRequestClose={() => setRetailerPickerOpen(false)}>
      <Pressable style={styles.modalBackdrop} onPress={() => setRetailerPickerOpen(false)}>
        <Pressable
          style={[styles.modalSheet, { backgroundColor: palette.card, borderColor: palette.border }]}
          onPress={() => undefined}
        >
          <Text style={[adminTypography.section, { color: palette.textPrimary, marginBottom: adminSpacing.sm }]}>
            Select retailer
          </Text>
          <FlatList
            data={retailers}
            keyExtractor={(item) => item.id}
            style={{ maxHeight: 360 }}
            renderItem={({ item }) => {
              const active = item.id === selectedRetailerId;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    triggerHaptic();
                    setSelectedRetailerId(item.id);
                    setRetailerPickerOpen(false);
                  }}
                  style={[
                    styles.retailerOption,
                    {
                      backgroundColor: active ? palette.primarySoft : palette.surfaceMuted,
                      borderColor: active ? palette.primary : palette.border,
                    },
                  ]}
                >
                  <Text style={{ color: palette.textPrimary, fontWeight: active ? "800" : "600" }} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {active ? (
                    <MaterialCommunityIcons name="check-circle" size={18} color={palette.primary} />
                  ) : null}
                </Pressable>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );

  if (loadingRetailers) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={palette.primary} />
        <Text style={[adminTypography.body, { color: palette.textMuted, marginTop: adminSpacing.sm }]}>
          Loading retailers…
        </Text>
      </View>
    );
  }

  if (error && retailers.length === 0) {
    return (
      <EmptyStateCard
        title="Unable to load retailers"
        subtitle={error}
        actionLabel="Retry"
        onAction={() => void loadRetailers()}
        palette={palette}
        icon="store-alert"
      />
    );
  }

  if (retailers.length === 0) {
    return (
      <EmptyStateCard
        title="No active retailers"
        subtitle="Create a retailer first, then allocate billing items here."
        palette={palette}
        icon="account-group-outline"
      />
    );
  }

  return (
    <View style={styles.container}>
      {renderRetailerPicker()}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Select retailer"
        onPress={() => setRetailerPickerOpen(true)}
        style={[styles.retailerSelect, { backgroundColor: palette.card, borderColor: palette.border }]}
      >
        <View style={styles.retailerSelectText}>
          <Text style={[adminTypography.caption, { color: palette.textMuted }]}>Retailer</Text>
          <Text style={[adminTypography.section, { color: palette.textPrimary }]} numberOfLines={1}>
            {selectedRetailer?.name ?? "Select retailer"}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-down" size={22} color={palette.textMuted} />
      </Pressable>

      <SectionHint
        text="Import billing items for the selected retailer. Set wholesale prices before saving — shop billing only shows allocated items."
        palette={palette}
      />

      <SearchField
        value={search}
        onChangeText={setSearch}
        placeholder="Search billing items"
        palette={palette}
        accessibilityLabel="Search billing items"
      />

      <View style={styles.filterRow}>
        {(
          [
            { value: "all", label: "All" },
            { value: "allocated", label: `Allocated (${allocatedCount})` },
            { value: "available", label: "Available" },
          ] as const
        ).map((chip) => (
          <ChipButton
            key={chip.value}
            label={chip.label}
            active={filter === chip.value}
            onPress={() => setFilter(chip.value)}
            palette={palette}
          />
        ))}
      </View>

      {pendingAddCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Allocate ${pendingAddCount} selected items`}
          onPress={allocatePending}
          style={[styles.bulkAction, { backgroundColor: palette.primarySoft, borderColor: palette.primary }]}
        >
          <MaterialCommunityIcons name="playlist-plus" size={18} color={palette.primary} />
          <Text style={{ color: palette.primaryStrong, fontWeight: "800" }}>
            Allocate {pendingAddCount} selected
          </Text>
        </Pressable>
      ) : null}

      {loadingItems ? (
        <View style={styles.centered}>
          <ActivityIndicator color={palette.primary} />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={filteredItems}
          keyExtractor={(item) => item.item_id}
          contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadItems(true)}
              tintColor={palette.primary}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: adminSpacing.xs }} />}
          ListEmptyComponent={
            <EmptyStateCard
              title={filter === "allocated" ? "No allocated items" : "No billing items found"}
              subtitle={
                filter === "allocated"
                  ? "Select available items and allocate them to this retailer."
                  : "Try a different search or add items in the billing catalogue."
              }
              palette={palette}
              icon="tag-off-outline"
            />
          }
          renderItem={({ item }) => {
            const allocated = allocations.has(item.item_id);
            const draft = allocations.get(item.item_id);
            const pending = pendingIds.has(item.item_id);
            const thumbUri = getItemThumbnailUri({
              image_thumb_path: item.image_thumb_path,
              image_path: item.image_path,
            });

            return (
              <View
                style={[
                  styles.itemCard,
                  { backgroundColor: palette.card, borderColor: allocated ? palette.primary : palette.border },
                ]}
              >
                <View style={styles.itemHeader}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: allocated || pending }}
                    onPress={() => {
                      if (allocated) {
                        toggleAllocated(item);
                        return;
                      }
                      togglePending(item.item_id);
                    }}
                    style={styles.itemHeaderPressable}
                  >
                    <MaterialCommunityIcons
                      name={
                        allocated
                          ? "check-circle"
                          : pending
                            ? "checkbox-marked-circle-outline"
                            : "checkbox-blank-circle-outline"
                      }
                      size={22}
                      color={allocated || pending ? palette.primary : palette.textMuted}
                    />
                    {thumbUri ? (
                      <ItemThumbnail
                        uri={thumbUri}
                        recyclingKey={item.item_id}
                        size={44}
                        borderRadius={8}
                        backgroundColor={palette.surfaceMuted}
                        icon="food-drumstick-outline"
                        iconColor={palette.textMuted}
                        iconSize={20}
                      />
                    ) : (
                      <View style={[styles.itemThumbFallback, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
                        <MaterialCommunityIcons name="food-drumstick-outline" size={20} color={palette.textMuted} />
                      </View>
                    )}
                    <View style={styles.itemText}>
                      <Text style={[adminTypography.section, { color: palette.textPrimary }]} numberOfLines={1}>
                        {item.item_name}
                      </Text>
                      {item.billing_price ? (
                        <Text style={[adminTypography.body, { color: palette.textMuted, marginTop: 2 }]}>
                          Billing {item.billing_price}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                  {allocated ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${item.item_name}`}
                      onPress={() => toggleAllocated(item)}
                      hitSlop={8}
                    >
                      <MaterialCommunityIcons name="close-circle-outline" size={22} color={palette.danger} />
                    </Pressable>
                  ) : null}
                </View>

                {allocated && draft ? (
                  <View style={styles.priceRow}>
                    <Text style={[adminTypography.caption, { color: palette.textMuted }]}>Wholesale price</Text>
                    <TextInput
                      value={draft.price_per_unit}
                      onChangeText={(value) => updatePrice(item.item_id, value)}
                      keyboardType="decimal-pad"
                      placeholder="Price per unit"
                      placeholderTextColor={palette.textMuted}
                      style={[
                        styles.priceInput,
                        {
                          color: palette.textPrimary,
                          borderColor: palette.border,
                          backgroundColor: palette.surfaceMuted,
                        },
                      ]}
                    />
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}

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
          accessibilityLabel="Save item allocations"
          disabled={saving || !selectedRetailerId || !dirty}
          onPress={() => void save()}
          style={[
            styles.saveButton,
            {
              backgroundColor: palette.primary,
              opacity: saving || !dirty ? 0.72 : 1,
            },
          ]}
        >
          {saving ? (
            <ActivityIndicator color={palette.onPrimary} />
          ) : (
            <Text style={{ color: palette.onPrimary, fontWeight: "800" }}>
              Save allocations ({allocatedCount})
            </Text>
          )}
        </Pressable>
      </View>
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
  retailerSelect: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: adminRadii.card,
    paddingHorizontal: adminSpacing.md,
    paddingVertical: 12,
    gap: adminSpacing.sm,
  },
  retailerSelectText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  bulkAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: adminRadii.card,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  itemCard: {
    borderWidth: 1,
    borderRadius: adminRadii.card,
    padding: 12,
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  itemHeaderPressable: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  itemText: {
    flex: 1,
    minWidth: 0,
  },
  itemThumbFallback: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  priceRow: {
    marginTop: 10,
    gap: 6,
  },
  priceInput: {
    borderWidth: 1,
    borderRadius: adminRadii.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: adminSpacing.lg,
  },
  modalSheet: {
    borderWidth: 1,
    borderRadius: adminRadii.card,
    padding: adminSpacing.md,
  },
  retailerOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderWidth: 1,
    borderRadius: adminRadii.control,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
});
