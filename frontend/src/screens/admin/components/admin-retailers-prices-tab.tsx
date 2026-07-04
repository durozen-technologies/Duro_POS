import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Animated,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchShops } from "@/api/admin";
import { toApiError } from "@/api/client";
import {
  fetchRetailerItemAllocations,
  fetchRetailers,
  updateRetailerItemAllocation,
} from "@/api/retailers";
import { CalendarDatePickerModal } from "@/components/ui/calendar-date-picker";
import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type {
  RetailerItemAllocationRead,
  RetailerRead,
  ShopRead,
  UUID,
} from "@/types/api";
import { getItemThumbnailUri } from "@/utils/item-images";

import { adminRadii, adminSpacing, adminTypography, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import { ActionButton, ChipButton, EmptyStateCard, SearchField } from "./admin-dashboard-primitives";


type PriceDraft = {
  item_id: UUID;
  item_name: string;
  item_tamil_name?: string | null;
  base_unit?: string | null;
  image_thumb_path?: string | null;
  image_path?: string | null;
  price_per_unit: string;
  saved_price_per_unit: string;
  billing_price?: string | null;
};

type AdminRetailersPricesTabProps = {
  palette: ThemePalette;
  refreshNonce?: number;
  onRefreshComplete?: () => void;
  initialShopId?: UUID | null;
  initialRetailerId?: UUID | null;
};

function normalizePrice(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return amount.toFixed(2);
}

function savedPriceFromItem(item: RetailerItemAllocationRead): string {
  return item.price_per_unit ? normalizePrice(String(item.price_per_unit)) : "";
}

function formatHistoryDate(dateString: string): string {
  const d = new Date(dateString);
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(d);
}

const PriceItemRow = memo(function PriceItemRow({ 
  item, 
  draft, 
  isHistoricalDate, 
  palette, 
  updatePrice,
  saveRow,
  isSaving,
}: {
  item: RetailerItemAllocationRead;
  draft: PriceDraft;
  isHistoricalDate: boolean;
  palette: ThemePalette;
  updatePrice: (itemId: UUID, price: string) => void;
  saveRow: (draft: PriceDraft) => void;
  isSaving: boolean;
}) {
  const inputRef = useRef<TextInput>(null);
  const [isFocused, setIsFocused] = useState(false);
  
  const currentNormalized = item.price_per_unit ? normalizePrice(String(draft.price_per_unit)) : normalizePrice(String(draft.price_per_unit));
  const isDirty = currentNormalized !== draft.saved_price_per_unit && currentNormalized !== "";
  const showSave = isFocused || isDirty;

  const thumbUri = getItemThumbnailUri({
    image_thumb_path: item.image_thumb_path,
    image_path: item.image_path,
  });

  return (
    <View
      style={[
        styles.priceRow,
        { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      {thumbUri ? (
        <ItemThumbnail
          uri={thumbUri}
          recyclingKey={item.item_id}
          size={64}
          borderRadius={12}
          backgroundColor={palette.surfaceMuted}
          icon="food-drumstick-outline"
          iconColor={palette.textMuted}
          iconSize={24}
        />
      ) : (
        <View style={[styles.itemThumbFallback, { width: 64, height: 64, borderRadius: 12, backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
          <MaterialCommunityIcons name="food-drumstick-outline" size={24} color={palette.textMuted} />
        </View>
      )}

      <View style={[styles.priceText, { flex: 1, paddingVertical: 4 }]}>
        <Text style={[adminTypography.bodyStrong, { color: palette.textPrimary, fontWeight: '800' }]} numberOfLines={1}>
          {item.item_name}
        </Text>
        {item.item_tamil_name ? (
          <Text style={[adminTypography.bodyStrong, { color: palette.primary, fontWeight: '800', marginTop: 2 }]} numberOfLines={1}>
            {item.item_tamil_name}
          </Text>
        ) : null}
        
        <Text style={[adminTypography.body, { color: palette.textPrimary, marginTop: 4, fontWeight: '600', opacity: 0.8 }]}>
          {draft.base_unit ? draft.base_unit.toUpperCase() : ''}
        </Text>

        {item.price_history?.[0]?.effective_date === new Date().toISOString().split("T")[0] && (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#d1fae5', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start', marginTop: 8, gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10b981' }} />
            <Text style={[adminTypography.caption, { color: '#10b981', fontWeight: 'bold' }]}>Updated today</Text>
          </View>
        )}
      </View>

      <View style={{
          backgroundColor: palette.surfaceMuted,
          borderRadius: 16,
          padding: 12,
          alignItems: 'center',
          minWidth: 120,
      }}>
          <Text style={[adminTypography.caption, { color: palette.textMuted, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '700' }]}>RATE</Text>
          <View style={{ 
            flexDirection: 'row', 
            alignItems: 'flex-end', 
            marginTop: 4,
            borderBottomWidth: isFocused ? 2 : 0,
            borderBottomColor: palette.primary,
            paddingBottom: isFocused ? 0 : 2,
          }}>
            <Text style={[adminTypography.bodyStrong, { color: palette.textPrimary, fontWeight: '800', paddingBottom: 1 }]}>₹</Text>
            <TextInput
                ref={inputRef}
                value={draft.price_per_unit}
                onChangeText={(value) => updatePrice(item.item_id, value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onSubmitEditing={() => saveRow(draft)}
                returnKeyType="done"
                keyboardType="decimal-pad"
                placeholder={
                  isHistoricalDate
                    ? "-"
                    : item.price_history?.[0]?.price_per_unit
                      ? normalizePrice(item.price_history[0].price_per_unit)
                      : draft.billing_price && Number(draft.billing_price) > 0
                        ? String(draft.billing_price)
                        : "0.00"
                }
                placeholderTextColor={palette.textMuted}
                editable={!isHistoricalDate}
                style={[
                  adminTypography.bodyStrong,
                  {
                    color: palette.textPrimary,
                    fontWeight: '800',
                    padding: 0,
                    margin: 0,
                    minWidth: 44,
                    textAlign: 'center',
                    opacity: isHistoricalDate ? 0.6 : 1,
                  }
                ]}
            />
            <Text style={[adminTypography.body, { color: palette.textPrimary, paddingBottom: 2, fontWeight: '700' }]}>/{draft.base_unit ? draft.base_unit.toLowerCase() : 'kg'}</Text>
          </View>
          
          {!isHistoricalDate && (
            <Pressable 
              disabled={isSaving}
              onPress={() => {
                if (showSave) {
                  inputRef.current?.blur();
                  saveRow(draft);
                } else {
                  inputRef.current?.focus();
                }
              }}
              style={({ pressed }) => [
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  marginTop: 10,
                  backgroundColor: pressed ? palette.surfaceMuted : 'transparent',
                  borderWidth: 1,
                  borderColor: showSave ? palette.primary : palette.border,
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                  borderRadius: 16,
                  opacity: isSaving ? 0.7 : 1,
                }
              ]}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={showSave ? palette.primary : palette.textPrimary} />
              ) : (
                <MaterialCommunityIcons 
                  name={showSave ? "check" : "pencil-outline"} 
                  size={14} 
                  color={showSave ? palette.primary : palette.textPrimary} 
                />
              )}
              <Text style={[adminTypography.caption, { color: showSave ? palette.primary : palette.textPrimary, fontWeight: '700' }]}>
                {isSaving ? "Saving..." : (showSave ? "Save" : "Edit")}
              </Text>
            </Pressable>
          )}
      </View>
    </View>
  );
});

export const AdminRetailersPricesTab = memo(function AdminRetailersPricesTab({
  palette,
  refreshNonce = 0,
  onRefreshComplete,
  initialShopId = null,
  initialRetailerId = null,
}: AdminRetailersPricesTabProps) {
  const insets = useSafeAreaInsets();
  const [branches, setBranches] = useState<ShopRead[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<UUID | null>(initialShopId);
  const [retailers, setRetailers] = useState<RetailerRead[]>([]);
  const [selectedRetailerId, setSelectedRetailerId] = useState<UUID | null>(initialRetailerId);
  const [catalogueItems, setCatalogueItems] = useState<RetailerItemAllocationRead[]>([]);
  const [drafts, setDrafts] = useState<Map<UUID, PriceDraft>>(new Map());
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [loadingRetailers, setLoadingRetailers] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingItemId, setSavingItemId] = useState<UUID | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [retailerPickerOpen, setRetailerPickerOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 250);

  const scrollY = useRef(new Animated.Value(0)).current;
  const [headerHeight, setHeaderHeight] = useState(260);

  const diffClampY = Animated.diffClamp(scrollY, 0, headerHeight);
  const headerTranslateY = diffClampY.interpolate({
    inputRange: [0, headerHeight],
    outputRange: [0, -headerHeight],
    extrapolate: "clamp",
  });

  const isHistoricalDate = useMemo(() => {
    if (!selectedDate) return false;
    const formattedToday = new Date().toISOString().split("T")[0];
    return selectedDate !== formattedToday;
  }, [selectedDate]);

  const selectedBranch = useMemo(
    () => branches.find((row) => row.id === selectedShopId) ?? null,
    [branches, selectedShopId],
  );

  const selectedRetailer = useMemo(
    () => retailers.find((row) => row.id === selectedRetailerId) ?? null,
    [retailers, selectedRetailerId],
  );

  const loadBranches = useCallback(async () => {
    setLoadingBranches(true);
    try {
      const rows = await fetchShops();
      const activeBranches = rows.filter((row) => row.is_active);
      setBranches(activeBranches);
      setSelectedShopId((current) => {
        if (current && activeBranches.some((row) => row.id === current)) {
          return current;
        }
        if (initialShopId && activeBranches.some((row) => row.id === initialShopId)) {
          return initialShopId;
        }
        return activeBranches[0]?.id ?? null;
      });
      setError(null);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setLoadingBranches(false);
    }
  }, [initialShopId]);

  const loadRetailers = useCallback(async () => {
    if (!selectedShopId) {
      setRetailers([]);
      setSelectedRetailerId(null);
      return;
    }
    setLoadingRetailers(true);
    try {
      const page = await fetchRetailers({
        active: true,
        shop_id: selectedShopId,
        page_size: 100,
      });
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
  }, [initialRetailerId, selectedShopId]);

  const loadItems = useCallback(
    async (isRefresh = false) => {
      if (!selectedShopId || !selectedRetailerId) {
        setCatalogueItems([]);
        setDrafts(new Map());
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoadingItems(true);
      try {
        const response = await fetchRetailerItemAllocations(
          selectedRetailerId,
          selectedShopId,
          {
            q: debouncedSearch || undefined,
            limit: 200,
            effective_date: selectedDate || undefined,
          },
        );
        const nextDrafts = new Map<UUID, PriceDraft>();
        for (const item of response.items) {
          const saved = savedPriceFromItem(item);
          nextDrafts.set(item.item_id, {
            item_id: item.item_id,
            item_name: item.item_name,
            item_tamil_name: item.item_tamil_name,
            base_unit: item.base_unit,
            image_thumb_path: item.image_thumb_path,
            image_path: item.image_path,
            price_per_unit: saved,
            saved_price_per_unit: saved,
            billing_price: item.billing_price,
          });
        }
        setCatalogueItems(response.items);
        setDrafts(nextDrafts);
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
    [debouncedSearch, onRefreshComplete, selectedRetailerId, selectedShopId, selectedDate],
  );

  useFocusEffect(
    useCallback(() => {
      void loadBranches();
    }, [loadBranches]),
  );

  useEffect(() => {
    void loadRetailers();
  }, [loadRetailers]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (refreshNonce > 0) {
      void loadBranches();
      void loadRetailers();
      void loadItems(true);
    }
  }, [loadBranches, loadItems, loadRetailers, refreshNonce]);

  useEffect(() => {
    if (initialShopId) setSelectedShopId(initialShopId);
  }, [initialShopId]);

  useEffect(() => {
    if (initialRetailerId) setSelectedRetailerId(initialRetailerId);
  }, [initialRetailerId]);

  const updatePrice = useCallback((itemId: UUID, price: string) => {
    setDrafts((current) => {
      const row = current.get(itemId);
      if (!row) return current;
      const next = new Map(current);
      next.set(itemId, { ...row, price_per_unit: price });
      return next;
    });
  }, []);

  const saveRow = useCallback(
    async (draft: PriceDraft) => {
      if (!selectedShopId || !selectedRetailerId) return;

      const nextPrice = normalizePrice(draft.price_per_unit);
      if (!nextPrice) {
        Alert.alert("Invalid price", `Set a wholesale price for ${draft.item_name}.`);
        return;
      }

      if (nextPrice === draft.saved_price_per_unit) {
        return;
      }

      setSavingItemId(draft.item_id);
      try {
        await updateRetailerItemAllocation(selectedRetailerId, selectedShopId, draft.item_id, {
          price_per_unit: nextPrice,
          is_active: true,
        });
        triggerHaptic();

        setDrafts((current) => {
          const next = new Map(current);
          const row = next.get(draft.item_id);
          if (row) {
            next.set(draft.item_id, {
              ...row,
              price_per_unit: nextPrice,
              saved_price_per_unit: nextPrice,
            });
          }
          return next;
        });
        setCatalogueItems((current) =>
          current.map((item) =>
            item.item_id === draft.item_id
              ? {
                  ...item,
                  is_allocated: true,
                  price_per_unit: nextPrice,
                  price_history: [
                    {
                      effective_date: new Date().toISOString().split("T")[0],
                      price_per_unit: nextPrice,
                    },
                    ...(item.price_history?.filter(
                      (h) => h.effective_date !== new Date().toISOString().split("T")[0],
                    ) || []),
                  ],
                }
              : item,
          ),
        );
      } catch (err) {
        Alert.alert("Save failed", toApiError(err).message);
      } finally {
        setSavingItemId(null);
      }
    },
    [selectedRetailerId, selectedShopId],
  );

  const saveAllChanges = useCallback(async () => {
    if (!selectedShopId || !selectedRetailerId) return;
    
    const changedItems: { item_id: UUID; price_per_unit: string }[] = [];
    
    for (const [itemId, draft] of drafts.entries()) {
      const nextPrice = normalizePrice(draft.price_per_unit);
      if (nextPrice && nextPrice !== draft.saved_price_per_unit) {
        changedItems.push({
          item_id: itemId,
          price_per_unit: nextPrice,
        });
      }
    }
    
    if (changedItems.length === 0) {
      Alert.alert("No changes", "There are no new prices to save.");
      return;
    }
    
    setSavingAll(true);
    try {
      await Promise.all(
        changedItems.map(item => 
          updateRetailerItemAllocation(selectedRetailerId, selectedShopId, item.item_id, {
            price_per_unit: item.price_per_unit,
            is_active: true,
          })
        )
      );
      
      triggerHaptic();
      
      setDrafts(current => {
        const next = new Map(current);
        for (const item of changedItems) {
          const row = next.get(item.item_id);
          if (row) {
             next.set(item.item_id, {
               ...row,
               price_per_unit: item.price_per_unit,
               saved_price_per_unit: item.price_per_unit,
             });
          }
        }
        return next;
      });
      
      setCatalogueItems(current => 
        current.map(item => {
          const changed = changedItems.find(c => c.item_id === item.item_id);
          if (changed) {
            return {
              ...item,
              is_allocated: true,
              price_per_unit: changed.price_per_unit,
              price_history: [
                {
                   effective_date: new Date().toISOString().split("T")[0],
                   price_per_unit: changed.price_per_unit,
                },
                ...(item.price_history?.filter(
                   (h) => h.effective_date !== new Date().toISOString().split("T")[0],
                ) || []),
              ],
            };
          }
          return item;
        })
      );
    } catch (err) {
      Alert.alert("Save failed", toApiError(err).message);
    } finally {
      setSavingAll(false);
    }
  }, [selectedShopId, selectedRetailerId, drafts]);

  const renderBranchPicker = () => (
    <Modal visible={branchPickerOpen} transparent animationType="fade" onRequestClose={() => setBranchPickerOpen(false)}>
      <Pressable style={styles.modalBackdrop} onPress={() => setBranchPickerOpen(false)}>
        <Pressable
          style={[styles.modalSheet, { backgroundColor: palette.card, borderColor: palette.border }]}
          onPress={() => undefined}
        >
          <Text style={[adminTypography.section, { color: palette.textPrimary, marginBottom: adminSpacing.sm }]}>
            Select branch
          </Text>
          <FlatList
            data={branches}
            keyExtractor={(item) => item.id}
            style={{ maxHeight: 360 }}
            renderItem={({ item }) => {
              const active = item.id === selectedShopId;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    triggerHaptic();
                    setSelectedShopId(item.id);
                    setBranchPickerOpen(false);
                  }}
                  style={[
                    styles.pickerOption,
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
                    styles.pickerOption,
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

  if (loadingBranches) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={palette.primary} />
        <Text style={[adminTypography.body, { color: palette.textMuted, marginTop: adminSpacing.sm }]}>
          Loading branches…
        </Text>
      </View>
    );
  }

  if (error && branches.length === 0) {
    return (
      <EmptyStateCard
        title="Unable to load branches"
        subtitle={error}
        actionLabel="Retry"
        onAction={() => void loadBranches()}
        palette={palette}
        icon="store-alert"
      />
    );
  }

  if (branches.length === 0) {
    return (
      <EmptyStateCard
        title="No active branches"
        subtitle="Create a branch first, then set retailer prices here."
        palette={palette}
        icon="store-off-outline"
      />
    );
  }

  return (
    <View style={styles.container}>
      {renderBranchPicker()}
      {renderRetailerPicker()}

      <Animated.View
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          backgroundColor: palette.background,
          gap: adminSpacing.sm,
          paddingBottom: adminSpacing.sm,
          transform: [{ translateY: headerTranslateY }],
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Select branch"
          onPress={() => setBranchPickerOpen(true)}
          style={[styles.selector, { backgroundColor: palette.card, borderColor: palette.border }]}
        >
          <Text style={[adminTypography.caption, { color: palette.textMuted, textTransform: "uppercase" }]}>Branch</Text>
          <View style={styles.selectorRow}>
            <Text style={[adminTypography.section, { color: palette.textPrimary }]} numberOfLines={1}>
              {selectedBranch?.name ?? "Select branch"}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={22} color={palette.textMuted} />
          </View>
        </Pressable>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Select retailer"
            disabled={!selectedShopId || loadingRetailers}
            onPress={() => setRetailerPickerOpen(true)}
            style={[
              styles.selector,
              {
                flex: 1,
                backgroundColor: palette.card,
                borderColor: palette.border,
                opacity: !selectedShopId || loadingRetailers ? 0.72 : 1,
              },
            ]}
          >
            <Text style={[adminTypography.caption, { color: palette.textMuted, textTransform: "uppercase" }]}>Retailer</Text>
            <View style={styles.selectorRow}>
              <Text style={[adminTypography.section, { color: palette.textPrimary }]} numberOfLines={1}>
                {loadingRetailers ? "Loading retailers…" : selectedRetailer?.name ?? "Select retailer"}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={22} color={palette.textMuted} />
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Information"
            onPress={() =>
              Alert.alert(
                "Daily retailer prices",
                "All branch-allocated items appear here. Set wholesale prices per retailer each day. Save only updates rows you changed — unchanged prices stay as shown.",
              )
            }
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: palette.card,
              borderWidth: 1,
              borderColor: palette.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MaterialCommunityIcons name="exclamation" size={24} color={palette.textMuted} />
          </Pressable>
        </View>

        {selectedRetailerId && selectedShopId ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: adminSpacing.sm, zIndex: 1 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setDatePickerOpen(true)}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 12,
                  height: 48,
                  borderRadius: adminRadii.control,
                  backgroundColor: palette.card,
                  borderWidth: 1,
                  borderColor: palette.border,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <MaterialCommunityIcons name="calendar-month" size={20} color={palette.textPrimary} />
                  <Text style={[adminTypography.bodyStrong, { color: palette.textPrimary }]}>
                    {selectedDate ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(selectedDate)) : "Today"}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-down" size={20} color={palette.textMuted} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void saveAllChanges()}
                disabled={savingAll}
                style={{
                  flex: 1.2,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  height: 48,
                  borderRadius: adminRadii.control,
                  backgroundColor: palette.primary,
                }}
              >
                {savingAll ? (
                  <ActivityIndicator size="small" color={palette.card} />
                ) : (
                  <>
                    <MaterialCommunityIcons name="content-save-outline" size={20} color={palette.card} />
                    <Text style={[adminTypography.bodyStrong, { color: palette.card }]}>Save</Text>
                  </>
                )}
              </Pressable>
            </View>
            <View style={{ zIndex: 1 }}>
              <SearchField
                value={search}
                onChangeText={setSearch}
                placeholder="Search branch items"
                palette={palette}
                accessibilityLabel="Search branch items"
              />
            </View>
          </>
        ) : null}
      </Animated.View>

      {!loadingRetailers && selectedShopId && retailers.length === 0 ? (
        <View style={{ flex: 1, paddingTop: headerHeight }}>
          <EmptyStateCard
            title="No retailers at this branch"
            subtitle="Assign retailers to this branch before setting wholesale prices."
            palette={palette}
            icon="account-group-outline"
          />
        </View>
      ) : null}

      {selectedRetailerId && selectedShopId && retailers.length > 0 ? (
        <>
          {loadingItems ? (
            <View style={[styles.centered, { paddingTop: headerHeight }]}>
              <ActivityIndicator color={palette.primary} />
            </View>
          ) : (
            <Animated.FlatList
              style={{ flex: 1 }}
              data={catalogueItems}
              keyExtractor={(item) => item.item_id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: Math.max(insets.bottom, 24) }}
              onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { y: scrollY } } }],
                { useNativeDriver: true }
              )}
              scrollEventThrottle={16}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => void loadItems(true)}
                  tintColor={palette.primary}
                  progressViewOffset={headerHeight}
                />
              }
              ItemSeparatorComponent={() => <View style={{ height: adminSpacing.sm }} />}
              ListEmptyComponent={
                <EmptyStateCard
                  title="No branch items allocated"
                  subtitle="Allocate items to this branch first, then set retailer prices here."
                  palette={palette}
                  icon="tag-off-outline"
                />
              }
              renderItem={({ item }) => {
                const draft = drafts.get(item.item_id);
                if (!draft) return null;

                return (
                  <PriceItemRow 
                    item={item} 
                    draft={draft} 
                    isHistoricalDate={isHistoricalDate} 
                    palette={palette} 
                    updatePrice={updatePrice} 
                    saveRow={saveRow}
                    isSaving={savingItemId === item.item_id}
                  />
                );
              }}
            />
          )}
        </>
      ) : null}

      <CalendarDatePickerModal
        visible={datePickerOpen}
        onClose={() => setDatePickerOpen(false)}
        value={selectedDate}
        onSelect={(date) => {
          setSelectedDate(date);
          setDatePickerOpen(false);
        }}
        colors={{
          overlay: "rgba(0,0,0,0.4)",
          card: palette.card,
          surface: palette.backgroundElevated,
          border: palette.border,
          textPrimary: palette.textPrimary,
          textSecondary: palette.textMuted,
          textMuted: palette.textMuted,
          accent: palette.primary,
          accentSoft: palette.primarySoft,
          onAccent: palette.card,
        }}
        title="Select Date"
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
  selector: {
    borderWidth: 1,
    borderRadius: adminRadii.control,
    paddingHorizontal: adminSpacing.md,
    paddingVertical: 8,
    gap: 2,
  },
  selectorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
    borderWidth: 1,
    borderRadius: adminRadii.control * 1.5,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  priceText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },

  priceEdit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 120,
    justifyContent: "flex-end",
  },
  priceInput: {
    borderRadius: adminRadii.control,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    fontWeight: "700",
    textAlign: "right",
    minWidth: 80,
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
  pickerOption: {
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
