import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAdminTranslation } from "@/hooks/use-admin-translation";

import { useFocusEffect } from "@react-navigation/native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchShops } from "@/api/admin";
import { formatApiErrorMessage } from "@/api/client";
import {
  fetchRetailerItemAllocations,
  fetchRetailers,
  fetchShopRetailerCatalog,
  syncRetailerItemAllocations,
  syncShopRetailerCatalog,
} from "@/api/retailers";
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
import { ChipButton, EmptyStateCard, SearchField } from "./admin-dashboard-primitives";
import { AdminSegmentedTabs } from "./admin-design-system";

type WorkMode = "branch" | "prices";

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
  initialShopId?: UUID | null;
  initialRetailerId?: UUID | null;
  onChromeVisibilityChange?: (visible: boolean) => void;
};

function defaultWholesalePrice(item: RetailerItemAllocationRead): string {
  const price = item.billing_price?.trim();
  return price && Number(price) > 0 ? price : "";
}

export const AdminRetailersAllocateItemsTab = memo(function AdminRetailersAllocateItemsTab({
  palette,
  refreshNonce = 0,
  onRefreshComplete,
  initialShopId = null,
  initialRetailerId = null,
  onChromeVisibilityChange,
}: AdminRetailersAllocateItemsTabProps) {
  const { t } = useAdminTranslation();
  const insets = useSafeAreaInsets();

  const [branches, setBranches] = useState<ShopRead[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<UUID | null>(initialShopId);
  const [retailers, setRetailers] = useState<RetailerRead[]>([]);
  const [selectedRetailerId, setSelectedRetailerId] = useState<UUID | null>(initialRetailerId);
  const [catalogueItems, setCatalogueItems] = useState<RetailerItemAllocationRead[]>([]);
  const [allocations, setAllocations] = useState<Map<UUID, AllocationDraft>>(new Map());
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [loadingRetailers, setLoadingRetailers] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ItemFilter>("all");
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [retailerPickerOpen, setRetailerPickerOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<UUID>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [workMode, setWorkMode] = useState<WorkMode>("branch");
  const [headerHeight, setHeaderHeight] = useState(220);
  const debouncedSearch = useDebouncedValue(search, 250);
  const scrollY = useRef(new Animated.Value(0)).current;
  const chromeVisibleRef = useRef(true);

  const diffClampY = Animated.diffClamp(scrollY, 0, headerHeight);
  const headerTranslateY = diffClampY.interpolate({
    inputRange: [0, headerHeight],
    outputRange: [0, -headerHeight],
    extrapolate: "clamp",
  });

  const handleListScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        listener: (event: { nativeEvent: { contentOffset: { y: number } } }) => {
          const nextVisible = event.nativeEvent.contentOffset.y < 28;
          if (nextVisible === chromeVisibleRef.current) return;
          chromeVisibleRef.current = nextVisible;
          onChromeVisibilityChange?.(nextVisible);
        },
      }),
    [onChromeVisibilityChange, scrollY],
  );

  useEffect(() => {
    return () => {
      onChromeVisibilityChange?.(true);
    };
  }, [onChromeVisibilityChange]);

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
      setError(formatApiErrorMessage(err));
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
      setError(formatApiErrorMessage(err));
    } finally {
      setLoadingRetailers(false);
    }
  }, [initialRetailerId, selectedShopId]);

  const loadItems = useCallback(
    async (isRefresh = false) => {
      if (!selectedShopId) {
        setCatalogueItems([]);
        setAllocations(new Map());
        return;
      }
      if (workMode === "prices" && !selectedRetailerId) {
        setCatalogueItems([]);
        setAllocations(new Map());
        return;
      }

      if (isRefresh) setRefreshing(true);
      else setLoadingItems(true);
      try {
        const response =
          workMode === "prices" && selectedRetailerId
            ? await fetchRetailerItemAllocations(selectedRetailerId, selectedShopId, {
                q: debouncedSearch || undefined,
                limit: 200,
              })
            : await fetchShopRetailerCatalog(selectedShopId, {
                q: debouncedSearch || undefined,
                limit: 200,
              });
        const nextAllocations = new Map<UUID, AllocationDraft>();
        for (const item of response.items) {
          if (!item.is_allocated) continue;
          nextAllocations.set(item.item_id, {
            item_id: item.item_id,
            item_name: item.item_name,
            image_thumb_path: item.image_thumb_path,
            image_path: item.image_path,
            price_per_unit: item.price_per_unit ?? defaultWholesalePrice(item),
            billing_price: item.billing_price,
          });
        }

        setCatalogueItems(response.items);
        setAllocations(nextAllocations);
        setPendingIds(new Set());
        setDirty(false);
        setError(null);
      } catch (err) {
        setError(formatApiErrorMessage(err));
      } finally {
        setLoadingItems(false);
        setRefreshing(false);
        if (isRefresh) {
          onRefreshComplete?.();
        }
      }
    },
    [debouncedSearch, onRefreshComplete, selectedRetailerId, selectedShopId, workMode],
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
    if (initialShopId) {
      setSelectedShopId(initialShopId);
    }
  }, [initialShopId]);

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

  const save = useCallback(async () => {
    if (!selectedShopId) return;
    if (workMode === "prices" && !selectedRetailerId) {
      Alert.alert(t("retailers.selectRetailer"), t("retailers.selectActiveRetailerHint"));
      return;
    }

    setSaving(true);
    try {
      if (workMode === "prices" && selectedRetailerId) {
        await syncRetailerItemAllocations(
          selectedRetailerId,
          selectedShopId,
          Array.from(allocations.keys()),
        );
        triggerHaptic();
        setDirty(false);
        await loadItems();
        Alert.alert(
          t("common.success"),
          t("retailers.itemsAllocatedToRetailer", {
            count: allocations.size,
            retailer: selectedRetailer?.name ?? t("retailers.retailer"),
          }),
        );
      } else {
        await syncShopRetailerCatalog(selectedShopId, Array.from(allocations.keys()));
        triggerHaptic();
        setDirty(false);
        await loadItems();
        Alert.alert(
          t("common.success"),
          t("retailers.itemsAllocatedToBranch", { count: allocations.size }),
        );
      }
    } catch (err) {
      Alert.alert(t("retailers.saveFailed"), formatApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [
    allocations,
    loadItems,
    selectedRetailer,
    selectedRetailerId,
    selectedShopId,
    workMode,
    t,
  ]);

  const renderBranchPicker = () => (
    <Modal visible={branchPickerOpen} transparent animationType="fade" onRequestClose={() => setBranchPickerOpen(false)}>
      <Pressable style={styles.modalBackdrop} onPress={() => setBranchPickerOpen(false)}>
        <Pressable
          style={[styles.modalSheet, { backgroundColor: palette.card, borderColor: palette.border }]}
          onPress={() => undefined}
        >
          <Text style={[adminTypography.section, { color: palette.textPrimary, marginBottom: adminSpacing.sm }]}>
            {t("retailers.selectBranch")}
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
            {t("retailers.selectRetailer")}
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
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: palette.textPrimary, fontWeight: active ? "800" : "600" }} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {item.shop_name || item.phone ? (
                      <Text style={{ color: palette.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                        {[item.shop_name, item.phone].filter(Boolean).join(" · ")}
                      </Text>
                    ) : null}
                  </View>
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
          {t("retailers.loadingBranches")}
        </Text>
      </View>
    );
  }

  if (error && branches.length === 0) {
    return (
      <EmptyStateCard
        title={t("retailers.loadBranchesFailed")}
        subtitle={error}
        actionLabel={t("action.retry")}
        onAction={() => void loadBranches()}
        palette={palette}
        icon="store-alert"
      />
    );
  }

  if (branches.length === 0) {
    return (
      <EmptyStateCard
        title={t("retailers.noActiveBranches")}
        subtitle={t("retailers.allocateItemsBranchHint")}
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
        <AdminSegmentedTabs
          items={[
            { value: "branch", label: t("retailers.perBranch"), icon: "store-outline" },
            { value: "prices", label: t("retailers.perRetailer"), icon: "account-outline" },
          ]}
          activeValue={workMode}
          palette={palette}
          onChange={(value) => {
            triggerHaptic();
            setWorkMode(value as WorkMode);
            setSearch("");
            setFilter("all");
            setDirty(false);
            scrollY.setValue(0);
            chromeVisibleRef.current = true;
            onChromeVisibilityChange?.(true);
          }}
        />

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("retailers.selectBranch")}
            onPress={() => setBranchPickerOpen(true)}
            style={[styles.selector, { flex: 1, backgroundColor: palette.card, borderColor: palette.border }]}
          >
            <View style={styles.selectorText}>
              <Text style={[adminTypography.caption, { color: palette.textMuted }]}>{t("retailers.branch")}</Text>
              <Text style={[adminTypography.section, { color: palette.textPrimary }]} numberOfLines={1}>
                {selectedBranch?.name ?? t("retailers.selectBranch")}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-down" size={22} color={palette.textMuted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
              accessibilityLabel={t("common.information")}
            onPress={() =>
              Alert.alert(
                t("common.information"),
                workMode === "prices"
                  ? t("retailers.allocationRetailerInfo")
                  : t("retailers.allocationBranchInfo"),
              )
            }
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
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

        {workMode === "prices" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("retailers.selectRetailer")}
            disabled={!selectedShopId || loadingRetailers || retailers.length === 0}
            onPress={() => setRetailerPickerOpen(true)}
            style={[
              styles.selector,
              {
                backgroundColor: palette.card,
                borderColor: palette.border,
                opacity: !selectedShopId || retailers.length === 0 ? 0.7 : 1,
              },
            ]}
          >
            <View style={styles.selectorText}>
              <Text style={[adminTypography.caption, { color: palette.textMuted }]}>
                {t("retailers.activeRetailer")}
              </Text>
              <Text style={[adminTypography.section, { color: palette.textPrimary }]} numberOfLines={1}>
                {loadingRetailers
                  ? t("retailers.loadingRetailers")
                  : selectedRetailer?.name ??
                    (retailers.length === 0
                      ? t("retailers.noActiveRetailers")
                      : t("retailers.selectRetailer"))}
              </Text>
              {selectedRetailer?.shop_name || selectedRetailer?.phone ? (
                <Text style={[adminTypography.caption, { color: palette.textMuted }]} numberOfLines={1}>
                  {[selectedRetailer.shop_name, selectedRetailer.phone].filter(Boolean).join(" · ")}
                </Text>
              ) : null}
            </View>
            <MaterialCommunityIcons name="chevron-down" size={22} color={palette.textMuted} />
          </Pressable>
        ) : null}

        {selectedShopId && (workMode === "branch" || selectedRetailerId) ? (
          <>
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder={
                workMode === "prices" ? t("retailers.searchRetailerItems") : t("retailers.searchBranchItems")
              }
              palette={palette}
              accessibilityLabel={
                workMode === "prices" ? t("retailers.searchRetailerItems") : t("retailers.searchBranchItems")
              }
            />

            <View style={styles.filterRow}>
              {(
                [
                  { value: "all", label: t("common.all") },
                  {
                    value: "allocated",
                    label: t("retailers.allocatedCount", { count: allocatedCount }),
                  },
                  { value: "available", label: t("common.available") },
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
          </>
        ) : null}
      </Animated.View>

      {selectedShopId && (workMode === "branch" || selectedRetailerId) ? (
        <>
          {loadingItems ? (
            <View style={[styles.centered, { paddingTop: headerHeight }]}>
              <ActivityIndicator color={palette.primary} />
            </View>
          ) : (
            <Animated.FlatList
              style={{ flex: 1 }}
              data={filteredItems}
              keyExtractor={(item) => item.item_id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                paddingTop: headerHeight,
                paddingBottom: 96 + insets.bottom,
                flexGrow: 1,
              }}
              onScroll={handleListScroll}
              scrollEventThrottle={16}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => void loadItems(true)}
                  tintColor={palette.primary}
                  progressViewOffset={headerHeight}
                />
              }
              ItemSeparatorComponent={() => <View style={{ height: adminSpacing.xs }} />}
              ListEmptyComponent={
                <EmptyStateCard
                  title={
                    filter === "allocated"
                      ? workMode === "prices"
                        ? "No items allocated to this retailer"
                        : "No branch items allocated"
                      : workMode === "prices"
                        ? "No branch catalogue items"
                        : "No billing items found"
                  }
                  subtitle={
                    filter === "allocated"
                      ? workMode === "prices"
                        ? "Select items from the branch catalogue for this active retailer."
                        : "Select items from the billing catalogue for this branch."
                      : workMode === "prices"
                        ? "Allocate items to this branch first (Per branch), then assign them to the retailer."
                        : "Try a different search or add items in the billing catalogue."
                  }
                  palette={palette}
                  icon="tag-off-outline"
                />
              }
              renderItem={({ item }) => {
                const allocated = allocations.has(item.item_id);
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
              accessibilityLabel={
                workMode === "prices" ? "Save retailer items" : "Save branch items"
              }
              disabled={
                saving ||
                !selectedShopId ||
                (workMode === "prices" && !selectedRetailerId) ||
                !dirty
              }
              onPress={() => void save()}
              style={[
                styles.saveButton,
                {
                  backgroundColor: palette.primary,
                  opacity:
                    saving ||
                    !dirty ||
                    (workMode === "prices" && !selectedRetailerId)
                      ? 0.72
                      : 1,
                },
              ]}
            >
              {saving ? (
                <ActivityIndicator color={palette.onPrimary} />
              ) : (
                <Text style={{ color: palette.onPrimary, fontWeight: "800" }}>
                  {workMode === "prices"
                    ? `Save retailer items (${allocatedCount})`
                    : `Save branch items (${allocatedCount})`}
                </Text>
              )}
            </Pressable>
          </View>
        </>
      ) : (
        <View style={{ flex: 1, paddingTop: headerHeight }}>
          {workMode === "prices" && selectedShopId && !loadingRetailers && retailers.length === 0 ? (
            <EmptyStateCard
              title="No active retailers at this branch"
              subtitle="Assign retailers to this branch before allocating items."
              palette={palette}
              icon="account-group-outline"
            />
          ) : null}
        </View>
      )}
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
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: adminRadii.card,
    paddingHorizontal: adminSpacing.md,
    paddingVertical: 8,
    gap: adminSpacing.sm,
  },
  selectorText: {
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
