import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import DraggableFlatList, { type RenderItemParams } from "react-native-draggable-flatlist";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  fetchShopExpenseItemRows,
  updateShopExpenseItemsOrder,
  type ExpenseCursorParams,
} from "@/api/expenses";
import { toApiError } from "@/api/client";
import type { AdminShopExpensesOrderScreenProps } from "@/navigation/types";
import type { ShopExpenseItemRead, UUID } from "@/types/api";

import type { ThemePalette } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { AdminHeaderActions } from "./components/admin-header-actions";
import { useAdminTheme } from "./use-admin-theme";

const PAGE_LIMIT = 500;

async function fetchAllExpenseAllocations(shopId: UUID) {
  const items: ShopExpenseItemRead[] = [];
  let params: ExpenseCursorParams = { limit: PAGE_LIMIT };

  while (true) {
    const page = await fetchShopExpenseItemRows(shopId, params);
    const existingIds = new Set(items.map((item) => item.id));
    items.push(...page.items.filter((item) => !existingIds.has(item.id)));

    if (!page.has_more || !page.next_cursor_name || !page.next_cursor_id) {
      break;
    }

    params = {
      limit: PAGE_LIMIT,
      cursor_sort_order: page.next_cursor_sort_order,
      cursor_name: page.next_cursor_name,
      cursor_id: page.next_cursor_id,
    };
  }

  return items;
}

function OrderRow({
  item,
  drag,
  isActive,
}: RenderItemParams<ShopExpenseItemRead>) {
  const { palette } = useAdminTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Arrange ${item.name}`}
      onLongPress={drag}
      delayLongPress={120}
      disabled={isActive}
      style={[
        styles.orderRow,
        {
          borderColor: isActive ? palette.cash : palette.border,
          backgroundColor: isActive ? palette.cashSoft : palette.card,
        },
      ]}
    >
      <View style={[styles.dragIconWrap, { backgroundColor: palette.cashSoft }]}>
        <MaterialCommunityIcons name="cash-minus" size={20} color={palette.cash} />
      </View>
      <View style={styles.orderText}>
        <Text numberOfLines={1} style={[styles.orderName, { color: palette.textPrimary }]}>
          {item.name}
        </Text>
        <Text numberOfLines={1} style={[styles.orderTamilName, { color: palette.textSecondary }]}>
          {item.tamil_name}
        </Text>
        <Text numberOfLines={1} style={[styles.orderMeta, { color: palette.textMuted }]}>
          {item.allocation_is_active ? "Usable" : "Hidden"} · current order {item.allocation_sort_order}
        </Text>
      </View>
      <MaterialCommunityIcons name="drag-horizontal-variant" size={22} color={palette.textMuted} />
    </Pressable>
  );
}

function OrderLoadingState({ palette }: { palette: ThemePalette }) {
  return (
    <View style={[styles.loadingState, { backgroundColor: palette.background }]}>
      <View style={[styles.loadingIcon, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <ActivityIndicator size="large" color={palette.primary} />
      </View>
      <Text style={[styles.loadingText, { color: palette.textMuted }]}>Loading branch expenses...</Text>
    </View>
  );
}

function OrderEmptyState({ palette }: { palette: ThemePalette }) {
  return (
    <View style={[styles.emptyState, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={[styles.emptyIcon, { backgroundColor: palette.cashSoft, borderColor: palette.border }]}>
        <MaterialCommunityIcons name="cash-minus" size={24} color={palette.cash} />
      </View>
      <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>No allocated expenses</Text>
      <Text style={[styles.emptyText, { color: palette.textMuted }]}>
        Allocate expense items before arranging branch order.
      </Text>
    </View>
  );
}

export function AdminShopExpensesOrderScreen({
  navigation,
  route,
}: AdminShopExpensesOrderScreenProps) {
  const insets = useSafeAreaInsets();
  const { colorScheme, palette } = useAdminTheme();
  const { shopId, shopName } = route.params;
  const [items, setItems] = useState<ShopExpenseItemRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const subtitle = useMemo(() => `${shopName || "Selected branch"} · ${items.length} expenses`, [items.length, shopName]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const loadedItems = await fetchAllExpenseAllocations(shopId);
      setItems(loadedItems);
      setDirty(false);
    } catch (error) {
      setErrorMessage(toApiError(error).message || "Unable to load branch expenses.");
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const saveOrder = useCallback(async () => {
    if (items.length === 0) {
      navigation.goBack();
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    try {
      await updateShopExpenseItemsOrder(shopId, {
        expense_item_ids: items.map((item) => item.id),
      });
      setDirty(false);
      navigation.navigate("AdminExpenses", { shopId });
    } catch (error) {
      setErrorMessage(toApiError(error).message || "Unable to save expense order.");
    } finally {
      setSaving(false);
    }
  }, [items, navigation, shopId]);

  const renderItem = useCallback((params: RenderItemParams<ShopExpenseItemRead>) => <OrderRow {...params} />, []);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View style={[styles.topBar, { backgroundColor: palette.shell, borderBottomColor: palette.shellBorder }]}>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text numberOfLines={1} style={[styles.title, { color: palette.onShell }]}>Arrange expenses</Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: palette.onShellMuted }]}>{subtitle}</Text>
        </View>
        <AdminHeaderActions refreshing={loading} refreshDisabled={saving} onRefresh={loadItems} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save expense order"
          accessibilityState={{ disabled: !dirty || saving || loading }}
          disabled={!dirty || saving || loading}
          onPress={() => {
            triggerHaptic();
            void saveOrder();
          }}
          style={[
            styles.saveButton,
            {
              backgroundColor: !dirty || saving || loading ? palette.shellControl : palette.primary,
              borderColor: !dirty || saving || loading ? palette.shellBorder : palette.primary,
              opacity: !dirty || saving || loading ? 0.65 : 1,
            },
          ]}
        >
          <MaterialCommunityIcons
            name="content-save-outline"
            size={17}
            color={!dirty || saving || loading ? palette.onShellMuted : palette.onPrimary}
          />
          <Text style={[styles.saveButtonText, { color: !dirty || saving || loading ? palette.onShellMuted : palette.onPrimary }]}>
            {saving ? "Saving" : "Save"}
          </Text>
        </Pressable>
      </View>

      {errorMessage ? (
        <View style={[styles.errorBanner, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</Text>
        </View>
      ) : null}

      {loading && items.length === 0 ? (
        <OrderLoadingState palette={palette} />
      ) : (
        <DraggableFlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onDragEnd={({ data }) => {
            setItems(data);
            setDirty(true);
          }}
          activationDistance={8}
          containerStyle={{ flex: 1, backgroundColor: palette.background }}
          contentContainerStyle={{ padding: 16, paddingBottom: 42 + insets.bottom, gap: 8 }}
          ListEmptyComponent={<OrderEmptyState palette={palette} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  topBar: {
    minHeight: 62,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  saveButton: {
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  saveButtonText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  loadingIcon: {
    width: 68,
    height: 68,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyState: {
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    paddingHorizontal: 18,
    paddingVertical: 28,
    alignItems: "center",
    gap: 12,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyText: {
    maxWidth: 320,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    textAlign: "center",
  },
  errorBanner: {
    margin: 14,
    marginBottom: 0,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  orderRow: {
    minHeight: 76,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dragIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  orderText: {
    flex: 1,
    minWidth: 0,
  },
  orderName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  orderTamilName: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  orderMeta: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
  },
});
