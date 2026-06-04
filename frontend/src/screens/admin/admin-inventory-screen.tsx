import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  allocateShopInventoryItems,
  createInventoryCategory,
  deleteInventoryCategory,
  deleteInventoryItem,
  fetchAdminInventoryMovements,
  fetchInventoryCategories,
  fetchInventoryItems,
  fetchShopInventoryAllocations,
  fetchShops,
  updateInventoryCategory,
  updateShopInventoryAllocation,
} from "@/api/admin";
import { toApiError } from "@/api/client";
import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import {
  BaseUnit,
  InventoryMovementType,
  type InventoryCategoryRead,
  type InventoryItemRead,
  type InventoryItemStockRead,
  type InventoryMovementRead,
  type InventorySummaryRead,
  type ShopRead,
  type UUID,
} from "@/types/api";
import { money } from "@/utils/decimal";
import { getItemThumbnailUri } from "@/utils/item-images";

import type { ThemePalette } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { AdminHeaderActions } from "./components/admin-header-actions";
import { useAdminTheme } from "./use-admin-theme";
import type { AdminInventoryScreenProps } from "@/navigation/types";

type InventoryTab = "items" | "categories" | "shops";

function getRequestMessage(error: unknown, fallback: string) {
  return toApiError(error).message || fallback;
}

function formatInventoryQuantity(value: string | number, unit: BaseUnit) {
  const numeric = money(value).toNumber();
  const display = unit === BaseUnit.UNIT && Number.isInteger(numeric)
    ? `${numeric}`
    : numeric.toFixed(unit === BaseUnit.UNIT ? 0 : 3).replace(/\.?0+$/, "");
  return `${display || "0"} ${unit === BaseUnit.KG ? "kg" : numeric === 1 ? "unit" : "units"}`;
}

function markInventoryItemAllocated(
  summary: InventorySummaryRead | null,
  itemId: UUID,
): InventorySummaryRead | null {
  if (!summary) {
    return summary;
  }
  return {
    ...summary,
    items: summary.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            allocated: true,
            allocation_active: item.is_active,
            allocation_sort_order: item.allocation_sort_order ?? item.sort_order,
          }
        : item,
    ),
  };
}

export function AdminInventoryScreen({ navigation, route }: AdminInventoryScreenProps) {
  const { colorScheme, palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<InventoryTab>("items");
  const [items, setItems] = useState<InventoryItemRead[]>([]);
  const [categories, setCategories] = useState<InventoryCategoryRead[]>([]);
  const [shops, setShops] = useState<ShopRead[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<UUID | null>(route.params?.shopId ?? null);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [summary, setSummary] = useState<InventorySummaryRead | null>(null);
  const [movements, setMovements] = useState<InventoryMovementRead[]>([]);
  const [movementHistoryOpen, setMovementHistoryOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [baseLoaded, setBaseLoaded] = useState(false);
  const [baseReloadKey, setBaseReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allocationBusyItemId, setAllocationBusyItemId] = useState<UUID | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<UUID | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const debouncedSearchRef = useRef("");
  const loadedItemsQueryRef = useRef<string | null>(null);

  const selectedShop = useMemo(
    () => shops.find((shop) => shop.id === selectedShopId) ?? null,
    [selectedShopId, shops],
  );
  const loadBaseData = useCallback(async (refresh = false) => {
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMessage(null);
    try {
      const inventorySearch = debouncedSearchRef.current.trim();
      const [nextCategories, nextItems, nextShops] = await Promise.all([
        fetchInventoryCategories(),
        fetchInventoryItems(inventorySearch ? { q: inventorySearch } : undefined),
        fetchShops(),
      ]);
      setCategories(nextCategories);
      setItems(nextItems);
      loadedItemsQueryRef.current = inventorySearch;
      setShops(nextShops);
      setSelectedShopId((currentShopId) =>
        currentShopId && nextShops.some((shop) => shop.id === currentShopId)
          ? currentShopId
          : nextShops[0]?.id ?? null,
      );
      if (nextShops.length === 0) {
        setSummary(null);
        setMovements([]);
      }
      setBaseLoaded(true);
      setBaseReloadKey((current) => current + 1);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to load inventory."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadShopData = useCallback(async (shopId: UUID) => {
    setErrorMessage(null);
    try {
      const [nextSummary, nextMovements] = await Promise.all([
        fetchShopInventoryAllocations(shopId),
        fetchAdminInventoryMovements({ shop_id: shopId, limit: 100 }),
      ]);
      setSummary(nextSummary);
      setMovements(nextMovements.items);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to load branch inventory."));
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadBaseData();
    return undefined;
  }, [loadBaseData]));

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    debouncedSearchRef.current = debouncedSearch;
  }, [debouncedSearch]);

  useEffect(() => {
    if (!baseLoaded || loadedItemsQueryRef.current === debouncedSearch) {
      return;
    }
    const controller = new AbortController();
    void fetchInventoryItems(
      debouncedSearch ? { q: debouncedSearch } : undefined,
      { signal: controller.signal },
    )
      .then((nextItems) => {
        loadedItemsQueryRef.current = debouncedSearch;
        setItems(nextItems);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        triggerHaptic();
        setErrorMessage(getRequestMessage(error, "Unable to search inventory items."));
      });
    return () => controller.abort();
  }, [baseLoaded, debouncedSearch]);

  useEffect(() => {
    setBranchDropdownOpen(false);
    setMovementHistoryOpen(false);
  }, [activeTab]);

  useEffect(() => {
    setMovementHistoryOpen(false);
  }, [selectedShopId]);

  useEffect(() => {
    if (!selectedShopId || !baseLoaded) {
      return;
    }
    void loadShopData(selectedShopId);
  }, [baseLoaded, baseReloadKey, loadShopData, selectedShopId]);

  const openCreateEditor = useCallback(() => {
    navigation.navigate("AdminInventoryItemEditor");
  }, [navigation]);

  const openEditEditor = useCallback((item: InventoryItemRead) => {
    navigation.navigate("AdminInventoryItemEditor", { itemId: item.id, initialItem: item });
  }, [navigation]);

  const confirmDeleteItem = useCallback((item: InventoryItemRead) => {
    Alert.alert("Delete inventory item", `Delete ${item.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteInventoryItem(item.id)
            .then(() => loadBaseData(true))
            .catch((error) => {
              triggerHaptic();
              setErrorMessage(getRequestMessage(error, "Unable to delete inventory item."));
            });
        },
      },
    ]);
  }, [loadBaseData]);

  const saveCategory = useCallback(async () => {
    const name = categoryDraft.trim();
    if (!name) {
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    try {
      await createInventoryCategory({ name });
      setCategoryDraft("");
      await loadBaseData(true);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to save inventory category."));
    } finally {
      setSaving(false);
    }
  }, [categoryDraft, loadBaseData]);

  const saveCategoryRename = useCallback(async (category: InventoryCategoryRead) => {
    const name = editingCategoryName.trim();
    if (!name) {
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    try {
      await updateInventoryCategory(category.id, { name });
      setEditingCategoryId(null);
      setEditingCategoryName("");
      await loadBaseData(true);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to rename inventory category."));
    } finally {
      setSaving(false);
    }
  }, [editingCategoryName, loadBaseData]);

  const confirmDeleteCategory = useCallback((category: InventoryCategoryRead) => {
    Alert.alert("Delete inventory category", `Delete ${category.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteInventoryCategory(category.id)
            .then(() => loadBaseData(true))
            .catch((error) => {
              triggerHaptic();
              setErrorMessage(getRequestMessage(error, "Unable to delete inventory category."));
            });
        },
      },
    ]);
  }, [loadBaseData]);

  const allocateItem = useCallback(async (itemId: UUID) => {
    if (!selectedShopId) {
      return;
    }
    if (allocationBusyItemId) {
      return;
    }
    const shopId = selectedShopId;
    setAllocationBusyItemId(itemId);
    setErrorMessage(null);
    try {
      await allocateShopInventoryItems(shopId, [itemId]);
      setSummary((currentSummary) =>
        currentSummary?.shop_id === shopId
          ? markInventoryItemAllocated(currentSummary, itemId)
          : currentSummary,
      );
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to allocate inventory item."));
    } finally {
      setAllocationBusyItemId(null);
    }
  }, [allocationBusyItemId, selectedShopId]);

  const toggleAllocation = useCallback(async (item: InventoryItemStockRead) => {
    if (!selectedShopId) {
      return;
    }
    if (allocationBusyItemId || !item.is_active) {
      return;
    }
    setAllocationBusyItemId(item.id);
    setErrorMessage(null);
    try {
      const nextSummary = await updateShopInventoryAllocation(selectedShopId, {
        item_id: item.id,
        is_active: !item.allocation_active,
      });
      setSummary(nextSummary);
    } catch (error) {
      triggerHaptic();
      setErrorMessage(getRequestMessage(error, "Unable to update inventory allocation."));
    } finally {
      setAllocationBusyItemId(null);
    }
  }, [allocationBusyItemId, selectedShopId]);

  const renderTabs = () => (
    <View style={[styles.tabs, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
      {[
        { key: "items", label: "Items", icon: "package-variant-closed" },
        { key: "categories", label: "Categories", icon: "shape-outline" },
        { key: "shops", label: "Branch stock", icon: "storefront-outline" },
      ].map((tab) => {
        const active = activeTab === tab.key;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => setActiveTab(tab.key as InventoryTab)}
            style={[styles.tab, { backgroundColor: active ? palette.card : "transparent" }]}
          >
            <MaterialCommunityIcons
              name={tab.icon as never}
              size={16}
              color={active ? palette.inventoryStrong : palette.textMuted}
            />
            <Text style={[styles.tabText, { color: active ? palette.inventoryStrong : palette.textMuted }]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const renderItems = () => (
    <View style={styles.section}>
      <View style={styles.row}>
        <View style={[styles.search, { borderColor: palette.border, backgroundColor: palette.card }]}>
          <MaterialCommunityIcons name="magnify" size={18} color={palette.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search inventory"
            placeholderTextColor={palette.textMuted}
            style={[styles.input, { color: palette.textPrimary }]}
          />
        </View>
        <ActionButton label="Add" icon="plus" palette={palette} active onPress={openCreateEditor} />
      </View>
      {items.map((item) => (
        <View key={item.id} style={[styles.itemRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
          <ItemThumbnail
            uri={getItemThumbnailUri(item)}
            recyclingKey={item.id}
            size={52}
            borderRadius={10}
            backgroundColor={palette.surfaceMuted}
            icon="package-variant-closed"
            iconColor={palette.textMuted}
          />
          <View style={styles.itemText}>
            <Text style={[styles.itemName, { color: palette.textPrimary }]}>{item.name}</Text>
            <Text style={[styles.itemSub, { color: palette.textSecondary }]}>{item.tamil_name}</Text>
            <Text style={[styles.itemMeta, { color: palette.textMuted }]}>
              {item.base_unit.toUpperCase()} · {item.categories.map((category) => category.name).join(", ")}
            </Text>
          </View>
          <View style={styles.rowActions}>
            <IconButton icon="pencil-outline" label="Edit" palette={palette} onPress={() => openEditEditor(item)} />
            <IconButton icon="delete-outline" label="Delete" palette={palette} danger onPress={() => confirmDeleteItem(item)} />
          </View>
        </View>
      ))}
    </View>
  );

  const renderCategories = () => (
    <View style={styles.section}>
      <View style={styles.row}>
        <View style={[styles.search, { borderColor: palette.border, backgroundColor: palette.card }]}>
          <MaterialCommunityIcons name="shape-plus" size={18} color={palette.textMuted} />
          <TextInput
            value={categoryDraft}
            onChangeText={setCategoryDraft}
            placeholder="New category"
            placeholderTextColor={palette.textMuted}
            style={[styles.input, { color: palette.textPrimary }]}
          />
        </View>
        <ActionButton label="Save" icon="content-save-outline" palette={palette} active loading={saving} onPress={() => void saveCategory()} />
      </View>
      {categories.map((category) => {
        const editing = editingCategoryId === category.id;
        return (
          <View key={category.id} style={[styles.itemRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
            <MaterialCommunityIcons name="shape-outline" size={22} color={palette.inventory} />
            {editing ? (
              <TextInput
                value={editingCategoryName}
                onChangeText={setEditingCategoryName}
                style={[styles.renameInput, { color: palette.textPrimary, borderColor: palette.border }]}
              />
            ) : (
              <Text style={[styles.itemName, styles.flex, { color: palette.textPrimary }]}>{category.name}</Text>
            )}
            <View style={styles.rowActions}>
              {editing ? (
                <>
                  <IconButton icon="check" label="Save" palette={palette} onPress={() => void saveCategoryRename(category)} />
                  <IconButton icon="close" label="Cancel" palette={palette} onPress={() => setEditingCategoryId(null)} />
                </>
              ) : (
                <>
                  <IconButton
                    icon="pencil-outline"
                    label="Rename"
                    palette={palette}
                    onPress={() => {
                      setEditingCategoryId(category.id);
                      setEditingCategoryName(category.name);
                    }}
                  />
                  <IconButton icon="delete-outline" label="Delete" palette={palette} danger onPress={() => confirmDeleteCategory(category)} />
                </>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );

  const renderShopStock = () => (
    <View style={styles.section}>
      <View style={styles.dropdownWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Select branch stock"
          accessibilityState={{ expanded: branchDropdownOpen, disabled: shops.length === 0 }}
          disabled={shops.length === 0}
          onPress={() => setBranchDropdownOpen((current) => !current)}
          style={[
            styles.branchSelect,
            {
              borderColor: branchDropdownOpen ? palette.inventory : palette.border,
              backgroundColor: palette.card,
              opacity: shops.length === 0 ? 0.65 : 1,
            },
          ]}
        >
          <View style={[styles.branchSelectIcon, { backgroundColor: palette.inventorySoft }]}>
            <MaterialCommunityIcons name="storefront-outline" size={18} color={palette.inventory} />
          </View>
          <View style={styles.branchSelectText}>
            <Text style={[styles.dropdownLabel, { color: palette.textMuted }]}>Branch</Text>
            <Text numberOfLines={1} style={[styles.dropdownValue, { color: palette.textPrimary }]}>
              {selectedShop?.name ?? "Select branch"}
            </Text>
          </View>
          <MaterialCommunityIcons
            name={branchDropdownOpen ? "chevron-up" : "chevron-down"}
            size={20}
            color={palette.textMuted}
          />
        </Pressable>
        {branchDropdownOpen ? (
          <View style={[styles.dropdownMenu, { borderColor: palette.border, backgroundColor: palette.card }]}>
            {shops.map((shop) => {
              const active = shop.id === selectedShopId;
              return (
                <Pressable
                  key={shop.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    setSelectedShopId(shop.id);
                    setBranchDropdownOpen(false);
                  }}
                  style={[
                    styles.dropdownOption,
                    {
                      backgroundColor: active ? palette.inventorySoft : "transparent",
                      borderColor: active ? palette.inventory : "transparent",
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={active ? "store-check-outline" : "storefront-outline"}
                    size={17}
                    color={active ? palette.inventory : palette.textMuted}
                  />
                  <Text
                    numberOfLines={1}
                    style={[styles.dropdownOptionText, { color: active ? palette.inventoryStrong : palette.textPrimary }]}
                  >
                    {shop.name}
                  </Text>
                  {active ? <MaterialCommunityIcons name="check" size={18} color={palette.inventory} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
      <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
        {selectedShop?.name ?? "Select branch"}
      </Text>
      {(summary?.items ?? []).map((item) => {
        const busy = allocationBusyItemId === item.id;
        const allocationDisabled = Boolean(allocationBusyItemId && !busy);
        return (
          <View key={item.id} style={[styles.stockItemCard, { borderColor: palette.border, backgroundColor: palette.card }]}>
            <View style={styles.stockItemHeader}>
              <ItemThumbnail
                uri={getItemThumbnailUri(item)}
                recyclingKey={item.id}
                size={48}
                borderRadius={10}
                backgroundColor={palette.surfaceMuted}
                icon="warehouse"
                iconColor={palette.textMuted}
              />
              <View style={styles.itemText}>
                <Text style={[styles.itemName, { color: palette.textPrimary }]}>{item.name}</Text>
                <View style={styles.itemQuantityRow}>
                  <View style={styles.itemQuantityGroup}>
                    <Text style={[styles.quantityLabel, { color: palette.textMuted }]}>Available</Text>
                    <Text style={[styles.quantityValue, { color: palette.textPrimary }]}>
                      {formatInventoryQuantity(item.available_quantity, item.base_unit)}
                    </Text>
                  </View>
                  <View style={styles.itemQuantityGroup}>
                    <Text style={[styles.quantityLabel, { color: palette.textMuted }]}>Used</Text>
                    <Text style={[styles.quantityValue, { color: palette.textPrimary }]}>
                      {formatInventoryQuantity(item.used_quantity, item.base_unit)}
                    </Text>
                  </View>
                </View>
              </View>
              {!item.is_active ? (
                <ActionButton
                  label="Inactive"
                  icon="cancel"
                  palette={palette}
                  disabled
                  onPress={() => undefined}
                />
              ) : item.allocated ? (
                <ActionButton
                  label={item.allocation_active ? "Pause" : "Activate"}
                  icon={item.allocation_active ? "pause-circle-outline" : "play-circle-outline"}
                  palette={palette}
                  loading={busy}
                  disabled={allocationDisabled}
                  onPress={() => void toggleAllocation(item)}
                />
              ) : (
                <ActionButton
                  label="Allocate"
                  icon="link-variant-plus"
                  palette={palette}
                  active
                  loading={busy}
                  disabled={allocationDisabled}
                  onPress={() => void allocateItem(item.id)}
                />
              )}
            </View>
            {item.category_usage.length > 0 ? (
              <View style={[styles.categoryUsageList, { borderTopColor: palette.border }]}>
                {item.category_usage.map((category) => (
                  <View
                    key={category.category_id}
                    style={[
                      styles.categoryUsageRow,
                      { borderColor: palette.border, backgroundColor: palette.surfaceMuted },
                    ]}
                  >
                    <Text numberOfLines={1} style={[styles.categoryUsageName, { color: palette.textPrimary }]}>
                      {category.category_name}
                    </Text>
                    <View style={styles.categoryUsageTotals}>
                      <View style={styles.categoryUsageTotal}>
                        <Text style={[styles.categoryUsageLabel, { color: palette.textMuted }]}>Used</Text>
                        <Text style={[styles.categoryUsageValue, { color: palette.textPrimary }]}>
                          {formatInventoryQuantity(category.used_quantity, item.base_unit)}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      <View style={styles.historyToggleRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: movementHistoryOpen }}
          onPress={() => setMovementHistoryOpen((current) => !current)}
          style={[
            styles.historyButton,
            {
              backgroundColor: movementHistoryOpen ? "#FFFFFF" : palette.success,
              borderColor: palette.success,
            },
          ]}
        >
          <MaterialCommunityIcons
            name={movementHistoryOpen ? "chevron-up" : "history"}
            size={20}
            color={movementHistoryOpen ? palette.success : "#FFFFFF"}
          />
          <Text style={[styles.historyButtonText, { color: movementHistoryOpen ? palette.success : "#FFFFFF" }]}>
            {movementHistoryOpen ? "Hide history" : "History"}
          </Text>
        </Pressable>
      </View>
      {movementHistoryOpen ? (
        <>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Recent movement</Text>
          {movements.length === 0 ? (
            <View style={[styles.movementRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
              <MaterialCommunityIcons name="history" size={20} color={palette.textMuted} />
              <Text style={[styles.itemMeta, { color: palette.textMuted }]}>No recent stock movement yet.</Text>
            </View>
          ) : (
            movements.map((movement) => (
              <View key={movement.id} style={[styles.movementRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
                <MaterialCommunityIcons
                  name={movement.movement_type === InventoryMovementType.ADD ? "plus-circle-outline" : "minus-circle-outline"}
                  size={20}
                  color={movement.movement_type === InventoryMovementType.ADD ? palette.success : palette.danger}
                />
                <View style={styles.itemText}>
                  <Text style={[styles.itemName, { color: palette.textPrimary }]}>{movement.inventory_item_name}</Text>
                  <Text style={[styles.itemMeta, { color: palette.textMuted }]}>
                    {movement.movement_type === InventoryMovementType.ADD ? "Added" : `Used for ${movement.category_name ?? "category"}`} · {formatInventoryQuantity(movement.quantity, movement.unit)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={["top", "left", "right"]}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <View style={[styles.topBar, { borderBottomColor: palette.border, paddingTop: Math.max(insets.top - 8, 0) }]}>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.textPrimary} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: palette.textPrimary }]}>Inventory</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>Items, categories, and branch stock</Text>
        </View>
        <AdminHeaderActions
          refreshing={refreshing}
          onRefresh={() => loadBaseData(true)}
        />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void loadBaseData(true)} tintColor={palette.inventory} colors={[palette.inventory]} />
        }
        contentContainerStyle={[styles.content, { paddingBottom: 34 + insets.bottom }]}
      >
        {renderTabs()}
        {errorMessage ? (
          <View style={[styles.errorBox, { borderColor: palette.danger, backgroundColor: palette.dangerSoft }]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
            <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
          </View>
        ) : null}
        {loading ? (
          <Text style={[styles.loadingText, { color: palette.textMuted }]}>Loading inventory...</Text>
        ) : activeTab === "items" ? (
          renderItems()
        ) : activeTab === "categories" ? (
          renderCategories()
        ) : (
          renderShopStock()
        )}
      </ScrollView>

    </SafeAreaView>
  );
}

function ActionButton({
  label,
  icon,
  palette,
  active = false,
  danger = false,
  loading = false,
  disabled = false,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  palette: ThemePalette;
  active?: boolean;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const fg = disabled ? palette.textMuted : danger ? palette.danger : active ? palette.onPrimary : palette.textPrimary;
  const bg = disabled ? palette.surfaceMuted : danger ? palette.dangerSoft : active ? palette.inventory : palette.card;
  const border = disabled ? palette.border : danger ? palette.danger : active ? palette.inventory : palette.border;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.actionButton, { borderColor: border, backgroundColor: bg, opacity: loading ? 0.65 : 1 }]}
    >
      <MaterialCommunityIcons name={icon} size={16} color={fg} />
      <Text numberOfLines={1} style={[styles.actionText, { color: fg }]}>{loading ? "..." : label}</Text>
    </Pressable>
  );
}

function IconButton({
  icon,
  label,
  palette,
  danger = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  palette: ThemePalette;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.iconButton}>
      <MaterialCommunityIcons name={icon} size={19} color={danger ? palette.danger : palette.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    minHeight: 70,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 20, fontWeight: "900", letterSpacing: 0 },
  subtitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0 },
  content: { padding: 16, gap: 14 },
  tabs: { flexDirection: "row", borderWidth: 1, borderRadius: 12, padding: 4, gap: 4 },
  tab: { flex: 1, minHeight: 42, borderRadius: 9, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  tabText: { fontSize: 12, fontWeight: "800", letterSpacing: 0 },
  section: { gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  historyToggleRow: { flexDirection: "row", justifyContent: "center", marginTop: 8 },
  historyButton: {
    width: "100%",
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  historyButtonText: { fontSize: 14, fontWeight: "900", letterSpacing: 0 },
  search: { minHeight: 46, flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, minHeight: 42, fontSize: 14, fontWeight: "700" },
  itemRow: { borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  stockItemCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  stockItemHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  categoryUsageList: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 7 },
  categoryUsageRow: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  categoryUsageName: { flex: 1, minWidth: 0, fontSize: 12, fontWeight: "900", letterSpacing: 0 },
  categoryUsageTotals: { alignItems: "flex-end", gap: 5 },
  categoryUsageTotal: { alignItems: "flex-end", gap: 1 },
  categoryUsageLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0, textTransform: "uppercase" },
  categoryUsageValue: { fontSize: 15, fontWeight: "900", letterSpacing: 0 },
  movementRow: { borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  itemText: { flex: 1, minWidth: 0, gap: 2 },
  itemName: { fontSize: 14, fontWeight: "900", letterSpacing: 0 },
  itemSub: { fontSize: 13, fontWeight: "700", letterSpacing: 0 },
  itemMeta: { fontSize: 12, fontWeight: "700", letterSpacing: 0 },
  itemQuantityRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 3 },
  itemQuantityGroup: { gap: 1 },
  quantityLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0, textTransform: "uppercase" },
  quantityValue: { fontSize: 16, fontWeight: "900", letterSpacing: 0 },
  rowActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  iconButton: { minWidth: 34, minHeight: 34, alignItems: "center", justifyContent: "center" },
  actionButton: { minHeight: 40, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  actionText: { fontSize: 12, fontWeight: "900", letterSpacing: 0 },
  errorBox: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { flex: 1, fontSize: 13, fontWeight: "700" },
  loadingText: { paddingVertical: 24, textAlign: "center", fontSize: 14, fontWeight: "800" },
  flex: { flex: 1 },
  renameInput: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, fontSize: 14, fontWeight: "800" },
  dropdownWrap: { gap: 8 },
  branchSelect: { minHeight: 58, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10 },
  branchSelectIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  branchSelectText: { flex: 1, minWidth: 0, gap: 2 },
  dropdownLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 0, textTransform: "uppercase" },
  dropdownValue: { fontSize: 15, fontWeight: "900", letterSpacing: 0 },
  dropdownMenu: { borderWidth: 1, borderRadius: 14, padding: 6, gap: 4 },
  dropdownOption: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  dropdownOptionText: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: "900", letterSpacing: 0 },
  sectionTitle: { fontSize: 15, fontWeight: "900", letterSpacing: 0, marginTop: 4 },
});
