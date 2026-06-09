import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  addShopInventoryStock,
  fetchShopInventoryRows,
  fetchShopInventoryMovements,
  useShopInventoryStock,
  useShopInventoryStockSplit,
} from "@/api/inventory";
import { toApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import { LoadingState } from "@/components/ui/loading-state";
import { Screen } from "@/components/ui/screen";
import { TextField } from "@/components/ui/text-field";
import {
  getLocalizedItemName,
  useShopTranslation,
} from "@/hooks/use-shop-translation";
import {
  BaseUnit,
  InventoryMovementType,
  type InventoryItemStockRead,
  type InventoryMovementRead,
  type UUID,
} from "@/types/api";
import { money } from "@/utils/decimal";
import { formatDateTime } from "@/utils/format";
import { getItemThumbnailUri } from "@/utils/item-images";
import type { InventoryManagementScreenProps } from "@/navigation/types";

type MovementMode = InventoryMovementType.ADD | InventoryMovementType.USE;
const HISTORY_BUTTON_GREEN = "#147D52";
const SHOP_INVENTORY_PAGE_SIZE = 50;

type InventoryCursor = {
  sortOrder: number | null;
  name: string | null;
  id: UUID | null;
};

const EMPTY_INVENTORY_CURSOR: InventoryCursor = {
  sortOrder: null,
  name: null,
  id: null,
};

function formatQuantity(value: string | number, unit?: BaseUnit) {
  const numeric = money(value).toNumber();
  const display = unit === BaseUnit.UNIT && Number.isInteger(numeric)
    ? `${numeric}`
    : numeric.toFixed(unit === BaseUnit.UNIT ? 0 : 3).replace(/\.?0+$/, "");
  if (!unit) {
    return display || "0";
  }
  return `${display || "0"} ${unit === BaseUnit.KG ? "kg" : numeric === 1 ? "unit" : "units"}`;
}

function isWholeQuantity(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && Number.isInteger(numeric);
}

function parseQuantityDraft(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return money(0);
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  return money(trimmed);
}

function isWholeDecimalValue(value: ReturnType<typeof money>) {
  return value.equals(value.toDecimalPlaces(0));
}

function mergeRecentMovements(current: InventoryMovementRead[], nextMovements: InventoryMovementRead[]) {
  const seen = new Set<UUID>();
  return [...nextMovements, ...current]
    .filter((movement) => {
      if (seen.has(movement.id)) {
        return false;
      }
      seen.add(movement.id);
      return true;
    })
    .slice(0, 30);
}

function patchInventoryRow(
  currentItems: InventoryItemStockRead[],
  changedItem: InventoryItemStockRead,
) {
  return currentItems.map((item) => (item.id === changedItem.id ? changedItem : item));
}

function visibleStockRows(items: InventoryItemStockRead[]) {
  return items
    .filter((item) => item.is_active && item.allocation_active)
    .sort((left, right) => left.allocation_sort_order - right.allocation_sort_order || left.name.localeCompare(right.name));
}

export function InventoryManagementScreen(_: InventoryManagementScreenProps) {
  const { language, t } = useShopTranslation();
  const [items, setItems] = useState<InventoryItemStockRead[]>([]);
  const [shopName, setShopName] = useState<string | null>(null);
  const [inventoryCursor, setInventoryCursor] = useState<InventoryCursor>(EMPTY_INVENTORY_CURSOR);
  const [inventoryHasMore, setInventoryHasMore] = useState(false);
  const [inventoryLoadingMore, setInventoryLoadingMore] = useState(false);
  const [movements, setMovements] = useState<InventoryMovementRead[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementsLoaded, setMovementsLoaded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<InventoryItemStockRead | null>(null);
  const [mode, setMode] = useState<MovementMode>(InventoryMovementType.ADD);
  const [quantity, setQuantity] = useState("");
  const [categoryQuantities, setCategoryQuantities] = useState<Record<UUID, string>>({});
  const inventoryCursorRef = useRef<InventoryCursor>(EMPTY_INVENTORY_CURSOR);
  const inventoryHasMoreRef = useRef(false);
  const inventoryLoadingRef = useRef(false);
  const inventoryLoadingMoreRef = useRef(false);
  const inventoryAbortRef = useRef<AbortController | null>(null);
  const inventoryRequestIdRef = useRef(0);
  const movementsLoadingRef = useRef(false);
  const movementsLoadedRef = useRef(false);

  const loadInventory = useCallback(async (refresh = false) => {
    inventoryAbortRef.current?.abort();
    const controller = new AbortController();
    inventoryAbortRef.current = controller;
    const requestId = ++inventoryRequestIdRef.current;
    inventoryLoadingRef.current = true;
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMessage(null);
    try {
      const page = await fetchShopInventoryRows(
        { limit: SHOP_INVENTORY_PAGE_SIZE },
        { signal: controller.signal },
      );
      if (controller.signal.aborted || requestId !== inventoryRequestIdRef.current) {
        return;
      }
      setShopName(page.shop_name);
      setItems(page.items);
      setInventoryHasMore(page.has_more);
      const nextCursor = {
        sortOrder: page.next_cursor_sort_order ?? null,
        name: page.next_cursor_name ?? null,
        id: page.next_cursor_id ?? null,
      };
      inventoryCursorRef.current = nextCursor;
      inventoryHasMoreRef.current = page.has_more;
      setInventoryCursor(nextCursor);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setErrorMessage(toApiError(error).message || t("inventory.loadFailed"));
    } finally {
      if (inventoryAbortRef.current === controller) {
        inventoryAbortRef.current = null;
      }
      if (requestId === inventoryRequestIdRef.current) {
        inventoryLoadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [t]);

  const loadMoreInventory = useCallback(async () => {
    if (
      !inventoryHasMoreRef.current ||
      inventoryLoadingRef.current ||
      inventoryLoadingMoreRef.current
    ) {
      return;
    }
    inventoryLoadingMoreRef.current = true;
    setInventoryLoadingMore(true);
    setErrorMessage(null);
    try {
      const page = await fetchShopInventoryRows({
        limit: SHOP_INVENTORY_PAGE_SIZE,
        cursor_sort_order: inventoryCursorRef.current.sortOrder,
        cursor_name: inventoryCursorRef.current.name,
        cursor_id: inventoryCursorRef.current.id,
      });
      setShopName(page.shop_name);
      setItems((currentItems) => {
        const existingIds = new Set(currentItems.map((item) => item.id));
        return [...currentItems, ...page.items.filter((item) => !existingIds.has(item.id))];
      });
      setInventoryHasMore(page.has_more);
      const nextCursor = {
        sortOrder: page.next_cursor_sort_order ?? null,
        name: page.next_cursor_name ?? null,
        id: page.next_cursor_id ?? null,
      };
      inventoryCursorRef.current = nextCursor;
      inventoryHasMoreRef.current = page.has_more;
      setInventoryCursor(nextCursor);
    } catch (error) {
      setErrorMessage(toApiError(error).message || t("inventory.loadFailed"));
    } finally {
      inventoryLoadingMoreRef.current = false;
      setInventoryLoadingMore(false);
    }
  }, [t]);

  useEffect(() => {
    inventoryCursorRef.current = inventoryCursor;
  }, [inventoryCursor]);

  useEffect(() => {
    inventoryHasMoreRef.current = inventoryHasMore;
  }, [inventoryHasMore]);

  useEffect(() => {
    inventoryLoadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    inventoryLoadingMoreRef.current = inventoryLoadingMore;
  }, [inventoryLoadingMore]);

  useEffect(() => {
    movementsLoadingRef.current = movementsLoading;
  }, [movementsLoading]);

  useEffect(() => {
    movementsLoadedRef.current = movementsLoaded;
  }, [movementsLoaded]);

  const loadMovements = useCallback(async (force = false) => {
    if (movementsLoadingRef.current || (movementsLoadedRef.current && !force)) {
      return;
    }
    movementsLoadingRef.current = true;
    setMovementsLoading(true);
    try {
      const nextMovements = await fetchShopInventoryMovements(30);
      setMovements(nextMovements.items);
      movementsLoadedRef.current = true;
      setMovementsLoaded(true);
    } catch (error) {
      setErrorMessage(toApiError(error).message || t("inventory.loadFailed"));
    } finally {
      movementsLoadingRef.current = false;
      setMovementsLoading(false);
    }
  }, [t]);

  useFocusEffect(useCallback(() => {
    void loadInventory();
    return undefined;
  }, [loadInventory]));

  useEffect(() => {
    if (historyOpen) {
      void loadMovements();
    }
  }, [historyOpen, loadMovements]);

  const refreshInventory = useCallback(() => {
    void loadInventory(true);
    if (historyOpen) {
      void loadMovements(true);
    }
  }, [historyOpen, loadInventory, loadMovements]);

  const openMovement = useCallback((item: InventoryItemStockRead, nextMode: MovementMode) => {
    if (!item.is_active || !item.allocation_active) {
      void loadInventory(true);
      return;
    }
    setSelectedItem(item);
    setMode(nextMode);
    setQuantity("");
    setCategoryQuantities({});
  }, [loadInventory]);

  const closeMovement = useCallback(() => {
    setSelectedItem(null);
    setQuantity("");
    setCategoryQuantities({});
  }, []);

  const splitState = useMemo(() => {
    if (!selectedItem) {
      return {
        splitTotal: money(0),
        remaining: money(0),
        hasValidTotal: false,
        hasValidSplit: false,
        splitMatchesTotal: false,
        canSave: false,
      };
    }
    const total = parseQuantityDraft(quantity);
    const hasValidTotal = Boolean(
      total &&
        total.greaterThan(0) &&
        (selectedItem.base_unit !== BaseUnit.UNIT || isWholeDecimalValue(total)),
    );
    let hasInvalidSplit = false;
    const splitTotal = selectedItem.category_usage.reduce((currentTotal, category) => {
      const parsed = parseQuantityDraft(categoryQuantities[category.category_id] ?? "");
      if (
        !parsed ||
        parsed.lessThan(0) ||
        (selectedItem.base_unit === BaseUnit.UNIT && !isWholeDecimalValue(parsed))
      ) {
        hasInvalidSplit = true;
        return currentTotal;
      }
      return currentTotal.plus(parsed);
    }, money(0));
    const normalizedTotal = total?.toDecimalPlaces(3) ?? money(0);
    const normalizedSplitTotal = splitTotal.toDecimalPlaces(3);
    const splitMatchesTotal = hasValidTotal && normalizedSplitTotal.equals(normalizedTotal);
    const withinAvailable = total
      ? total.toDecimalPlaces(3).lessThanOrEqualTo(money(selectedItem.available_quantity).toDecimalPlaces(3))
      : false;
    const hasCategories = selectedItem.category_usage.length > 0;
    const hasValidSplit =
      !hasInvalidSplit &&
      hasCategories &&
      splitTotal.greaterThan(0) &&
      splitMatchesTotal;
    return {
      splitTotal,
      remaining: normalizedTotal.minus(normalizedSplitTotal),
      hasValidTotal,
      hasValidSplit,
      splitMatchesTotal,
      canSave: mode === InventoryMovementType.ADD
        ? hasValidTotal
        : (hasCategories ? hasValidSplit : hasValidTotal) && withinAvailable,
    };
  }, [categoryQuantities, mode, quantity, selectedItem]);

  const saveMovement = useCallback(async () => {
    if (!selectedItem) {
      return;
    }
    const rawQuantity = quantity.trim();
    if (!rawQuantity || money(rawQuantity).lessThanOrEqualTo(0)) {
      Alert.alert(t("inventory.invalidQuantityTitle"), t("inventory.invalidQuantityMessage"));
      return;
    }
    if (selectedItem.base_unit === BaseUnit.UNIT && !isWholeQuantity(rawQuantity)) {
      Alert.alert(t("inventory.invalidQuantityTitle"), t("billing.alertInvalidUnitQuantityMessage", {
        itemName: getLocalizedItemName(language, selectedItem.name, selectedItem.tamil_name),
      }));
      return;
    }
    if (mode === InventoryMovementType.USE && !splitState.canSave) {
      if (selectedItem.category_usage.length > 0) {
        Alert.alert(t("inventory.categoryRequiredTitle"), t("inventory.categoryRequiredMessage"));
      } else {
        Alert.alert(t("inventory.invalidQuantityTitle"), t("inventory.invalidQuantityMessage"));
      }
      return;
    }
    setSaving(true);
    try {
      let changedItem: InventoryItemStockRead;
      let nextMovements: InventoryMovementRead[];
      if (mode === InventoryMovementType.ADD) {
        const result = await addShopInventoryStock(selectedItem.id, { quantity: rawQuantity });
        changedItem = result.item;
        nextMovements = [result.movement];
        if (result.summary) {
          setItems(visibleStockRows(result.summary.items));
        } else {
          setItems((currentItems) => patchInventoryRow(currentItems, changedItem));
        }
      } else if (selectedItem.category_usage.length === 0) {
        const result = await useShopInventoryStock(selectedItem.id, { quantity: rawQuantity });
        changedItem = result.item;
        nextMovements = [result.movement];
        if (result.summary) {
          setItems(visibleStockRows(result.summary.items));
        } else {
          setItems((currentItems) => patchInventoryRow(currentItems, changedItem));
        }
      } else {
        const result = await useShopInventoryStockSplit(selectedItem.id, {
          total_quantity: rawQuantity,
          categories: selectedItem.category_usage.map((category) => ({
            category_id: category.category_id,
            quantity: categoryQuantities[category.category_id]?.trim() || "0",
          })),
        });
        changedItem = result.item;
        nextMovements = result.movements;
        if (result.summary) {
          setItems(visibleStockRows(result.summary.items));
        } else {
          setItems((currentItems) => patchInventoryRow(currentItems, changedItem));
        }
      }
      setMovements((current) => mergeRecentMovements(current, nextMovements));
      closeMovement();
    } catch (error) {
      const apiError = toApiError(error);
      const normalizedMessage = apiError.message.toLowerCase();
      const inventoryUnavailable =
        normalizedMessage.includes("inactive") ||
        normalizedMessage.includes("not allocated");
      if (inventoryUnavailable) {
        closeMovement();
        void loadInventory(true);
      }
      Alert.alert(t("inventory.saveFailedTitle"), apiError.message || t("inventory.saveFailedMessage"));
    } finally {
      setSaving(false);
    }
  }, [categoryQuantities, closeMovement, language, loadInventory, mode, quantity, selectedItem, splitState.canSave, t]);

  if (loading && items.length === 0) {
    return <LoadingState fullscreen label={t("inventory.loading")} />;
  }

  if (errorMessage && items.length === 0) {
    return (
      <Screen>
        <EmptyState title={t("inventory.loadFailed")} description={errorMessage} />
        <Button label={t("action.tryAgain")} onPress={() => void loadInventory()} className="mt-4" />
      </Screen>
    );
  }

  const renderInventoryRow = ({ item }: { item: InventoryItemStockRead }) => {
    const itemName = getLocalizedItemName(language, item.name, item.tamil_name);
    return (
      <Card className="gap-4">
        <View className="flex-row gap-3">
          <ItemThumbnail
            uri={getItemThumbnailUri(item)}
            recyclingKey={item.id}
            size={58}
            borderRadius={14}
            backgroundColor="#F4F7F2"
            icon="warehouse"
            iconColor="#6C7A70"
          />
          <View className="min-w-0 flex-1">
            <Text className="text-base font-extrabold text-ink" numberOfLines={2}>{itemName}</Text>
            <Text className="mt-1 text-sm font-semibold text-muted">
              {formatQuantity(item.available_quantity, item.base_unit)} {t("inventory.available")}
            </Text>
            <Text className="mt-1 text-xs font-semibold text-muted">
              {t("inventory.used")} {formatQuantity(item.used_quantity, item.base_unit)}
            </Text>
          </View>
        </View>
        <View className="flex-row gap-2">
          <Button
            label={t("inventory.addStock")}
            onPress={() => openMovement(item, InventoryMovementType.ADD)}
            className="flex-1"
          />
          <Button
            label={t("inventory.useStock")}
            onPress={() => openMovement(item, InventoryMovementType.USE)}
            variant="secondary"
            disabled={money(item.available_quantity).lessThanOrEqualTo(0)}
            className="flex-1"
          />
        </View>
        <View className="gap-2 border-t border-border/70 pt-3">
          {item.category_usage.map((category) => (
            <View key={category.category_id} className="flex-row items-center justify-between gap-3">
              <Text className="min-w-0 flex-1 text-sm font-semibold text-ink" numberOfLines={1}>
                {category.category_name}
              </Text>
              <Text className="text-xs font-semibold text-muted">
                {t("inventory.used")} {formatQuantity(category.used_quantity, item.base_unit)}
              </Text>
            </View>
          ))}
        </View>
      </Card>
    );
  };

  const renderInventoryFooter = () => (
    <View className="gap-3 pt-1">
      {inventoryLoadingMore ? (
        <Card className="items-center border-border bg-card">
          <ActivityIndicator color="#244734" />
        </Card>
      ) : null}
      <View className="w-full items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: historyOpen }}
          onPress={() => setHistoryOpen((current) => !current)}
          className="flex-row items-center justify-center gap-2"
          style={{
            width: "100%",
            minHeight: 52,
            borderWidth: 1,
            borderRadius: 14,
            paddingHorizontal: 22,
            backgroundColor: historyOpen ? "#FFFFFF" : HISTORY_BUTTON_GREEN,
            borderColor: HISTORY_BUTTON_GREEN,
          }}
        >
          <MaterialCommunityIcons
            name={historyOpen ? "chevron-up" : "history"}
            size={20}
            color={historyOpen ? HISTORY_BUTTON_GREEN : "#FFFFFF"}
          />
          <Text
            className="text-sm font-extrabold"
            style={{ color: historyOpen ? HISTORY_BUTTON_GREEN : "#FFFFFF" }}
          >
            {historyOpen ? t("inventory.hideHistory") : t("inventory.history")}
          </Text>
        </Pressable>
      </View>
      {historyOpen ? (
        <>
          <Text className="text-base font-extrabold text-ink">{t("inventory.recentMovement")}</Text>
          {movementsLoading ? (
            <Card className="flex-row items-center gap-3 border-border bg-card">
              <ActivityIndicator color="#244734" />
              <Text className="text-sm font-semibold text-muted">{t("inventory.loading")}</Text>
            </Card>
          ) : movements.length === 0 ? (
            <Card className="border-border bg-card">
              <Text className="text-sm font-semibold text-muted">{t("inventory.noRecentMovement")}</Text>
            </Card>
          ) : (
            movements.map((movement) => {
              const movementItemName = getLocalizedItemName(
                language,
                movement.inventory_item_name,
                movement.inventory_item_tamil_name,
              );
              const isAdd = movement.movement_type === InventoryMovementType.ADD;
              const movementLabel = isAdd
                ? t("inventory.movementAdded")
                : movement.category_name
                  ? t("inventory.movementUsedFor", { categoryName: movement.category_name })
                  : t("inventory.used");
              return (
                <Card key={movement.id} className="flex-row items-center gap-3">
                  <MaterialCommunityIcons
                    name={isAdd ? "plus-circle-outline" : "minus-circle-outline"}
                    size={22}
                    color={isAdd ? "#168A5B" : "#9F4335"}
                  />
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-extrabold text-ink" numberOfLines={1}>
                      {movementItemName}
                    </Text>
                    <Text className="mt-0.5 text-xs font-semibold text-muted" numberOfLines={1}>
                      {movementLabel} · {formatQuantity(movement.quantity, movement.unit)}
                    </Text>
                    <Text className="mt-0.5 text-[11px] font-semibold text-muted">
                      {formatDateTime(movement.created_at)}
                    </Text>
                  </View>
                </Card>
              );
            })
          )}
        </>
      ) : null}
    </View>
  );

  return (
    <View className="flex-1 bg-cream">
      <Screen scroll={false}>
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderInventoryRow}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refreshInventory} tintColor="#244734" colors={["#244734"]} />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 28, gap: 14 }}
          ListHeaderComponent={(
            <>
              {errorMessage ? (
                <Card className="border-[#9F4335] bg-[#FFF2EF]">
                  <Text className="text-sm font-semibold text-[#9F4335]">{errorMessage}</Text>
                </Card>
              ) : null}
              {shopName ? (
                <View className="rounded-[14px] border border-border bg-card px-4 py-3">
                  <Text className="text-xs font-extrabold uppercase tracking-[1px] text-muted">
                    {t("inventory.branchName", { branchName: shopName })}
                  </Text>
                </View>
              ) : null}
            </>
          )}
          ListEmptyComponent={
            !loading ? (
              <EmptyState title={t("inventory.emptyTitle")} description={t("inventory.emptyDescription")} />
            ) : null
          }
          ListFooterComponent={renderInventoryFooter}
          onEndReached={() => void loadMoreInventory()}
          onEndReachedThreshold={0.35}
        />
      </Screen>

      <Modal visible={Boolean(selectedItem)} animationType="fade" transparent onRequestClose={closeMovement}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1 justify-center bg-black/45 px-4"
        >
          <View
            className="w-full self-center rounded-[20px] border border-border bg-card p-4 shadow-soft"
            style={{ maxHeight: "88%", maxWidth: 460 }}
          >
            {selectedItem ? (
              <>
                <View className="flex-row items-start justify-between gap-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-lg font-extrabold text-ink">
                      {mode === InventoryMovementType.ADD ? t("inventory.addStock") : t("inventory.useStock")}
                    </Text>
                    <Text className="mt-1 text-sm font-semibold text-muted" numberOfLines={2}>
                      {getLocalizedItemName(language, selectedItem.name, selectedItem.tamil_name)}
                    </Text>
                  </View>
                  <Pressable accessibilityRole="button" onPress={closeMovement} className="h-10 w-10 items-center justify-center">
                    <MaterialCommunityIcons name="close" size={22} color="#1E2B22" />
                  </Pressable>
                </View>

                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ gap: 12, paddingTop: 10, paddingBottom: 2 }}
                >
                  {mode === InventoryMovementType.USE ? (
                    <View className="items-center rounded-[16px] border border-accent bg-accentSoft px-4 py-3">
                      <Text className="text-[11px] font-semibold uppercase tracking-[1px] text-muted">
                        {t("inventory.available")}
                      </Text>
                      <Text className="mt-1 text-4xl font-extrabold text-ink">
                        {formatQuantity(selectedItem.available_quantity, selectedItem.base_unit)}
                      </Text>
                    </View>
                  ) : null}
                  <TextField
                    label={mode === InventoryMovementType.USE
                      ? selectedItem.base_unit === BaseUnit.KG
                        ? "Total to use (kg)"
                        : "Total to use (units)"
                      : selectedItem.base_unit === BaseUnit.KG
                        ? t("common.quantityKg")
                        : t("common.quantityUnits")}
                    keyboardType="decimal-pad"
                    placeholder={selectedItem.base_unit === BaseUnit.KG ? t("common.exampleKg") : t("common.exampleUnits")}
                    value={quantity}
                    onChangeText={setQuantity}
                    suffix={selectedItem.base_unit}
                    autoFocus={mode === InventoryMovementType.USE}
                    selectTextOnFocus
                    className={mode === InventoryMovementType.USE ? "text-center text-2xl font-extrabold" : undefined}
                  />
                  {mode === InventoryMovementType.USE && selectedItem.category_usage.length > 0 ? (
                    <View className="gap-2">
                      <View className="flex-row items-center justify-between gap-3">
                        <Text className="text-[11px] font-semibold uppercase text-muted">{t("inventory.category")}</Text>
                        <Text className="text-[11px] font-semibold uppercase text-muted">Split</Text>
                      </View>
                      <View className="gap-2">
                        {selectedItem.category_usage.map((category) => (
                          <View
                            key={category.category_id}
                            className="min-h-[62px] flex-row items-center gap-3 rounded-[14px] border border-border bg-surface px-3 py-2"
                          >
                            <View className="min-w-0 flex-1">
                              <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
                                {category.category_name}
                              </Text>
                              <Text className="mt-0.5 text-xs font-semibold text-muted">
                                {t("inventory.used")} {formatQuantity(category.used_quantity, selectedItem.base_unit)}
                              </Text>
                            </View>
                            <View className="h-11 w-32 flex-row items-center rounded-[12px] border border-border bg-card px-2">
                              <TextInput
                                keyboardType="decimal-pad"
                                placeholder={selectedItem.base_unit === BaseUnit.KG ? t("common.exampleKg") : t("common.exampleUnits")}
                                placeholderTextColor="#95A293"
                                value={categoryQuantities[category.category_id] ?? ""}
                                onChangeText={(nextQuantity) =>
                                  setCategoryQuantities((current) => ({
                                    ...current,
                                    [category.category_id]: nextQuantity,
                                  }))
                                }
                                selectTextOnFocus
                                autoCorrect={false}
                                underlineColorAndroid="transparent"
                                selectionColor="#244734"
                                cursorColor="#244734"
                                className="min-w-0 flex-1 text-center text-xl font-extrabold text-ink"
                              />
                              <Text className="text-xs font-semibold uppercase text-muted">{selectedItem.base_unit}</Text>
                            </View>
                          </View>
                        ))}
                      </View>
                      <View className="rounded-[14px] border border-border bg-card px-4 py-3">
                        <View className="flex-row items-center justify-between gap-3">
                          <Text className="text-xs font-semibold uppercase text-muted">Split total</Text>
                          <Text className="text-2xl font-extrabold text-ink">
                            {formatQuantity(splitState.splitTotal.toString(), selectedItem.base_unit)}
                          </Text>
                        </View>
                        {!splitState.splitMatchesTotal ? (
                          <View className="mt-2 flex-row items-center justify-between gap-3">
                            <Text className="text-xs font-semibold uppercase text-muted">Remaining</Text>
                            <Text className="text-sm font-extrabold text-[#9F4335]">
                              {formatQuantity(splitState.remaining.abs().toString(), selectedItem.base_unit)}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  ) : null}
                </ScrollView>

                <View className="mt-3 flex-row gap-2">
                  <Button label={t("action.cancel")} onPress={closeMovement} variant="secondary" className="flex-1" />
                  <Button
                    label={saving ? t("inventory.saving") : t("inventory.save")}
                    onPress={() => void saveMovement()}
                    loading={saving}
                    disabled={!splitState.canSave}
                    className="flex-1"
                  />
                </View>
              </>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
