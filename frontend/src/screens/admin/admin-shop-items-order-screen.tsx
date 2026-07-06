import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import DraggableFlatList, { type RenderItemParams } from "react-native-draggable-flatlist";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Button as TButton, Spinner, XStack, YStack } from "tamagui";

import {
  fetchSelectedShopItemsPage,
  updateSelectedShopItemsOrder,
  type FetchShopItemsParams,
} from "@/api/admin";
import { toApiError, formatApiErrorMessage } from "@/api/client";
import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import type { AdminShopItemsOrderScreenProps } from "@/navigation/types";
import { UnitType, type ShopItemRead, type UUID } from "@/types/api";
import { getItemThumbnailUri } from "@/utils/item-images";

import type { ThemePalette } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { AdminHeaderActions } from "./components/admin-header-actions";
import { EmptyState, ErrorState } from "./components/admin-items-management";
import { useAdminTheme } from "./use-admin-theme";

const UNCATEGORIZED_ORDER_KEY = "uncategorized";
const PAGE_LIMIT = 500;

type OrderGroup = {
  key: string;
  label: string;
  items: ShopItemRead[];
};

function getOrderCategoryKey(item: ShopItemRead) {
  const categoryId = item.category_id?.trim();
  if (categoryId) {
    return `category-id:${categoryId}`;
  }
  const categoryName = item.category?.trim();
  if (categoryName) {
    return `category-name:${categoryName.toLowerCase()}`;
  }
  return UNCATEGORIZED_ORDER_KEY;
}

function getOrderCategoryLabel(item: ShopItemRead) {
  return item.category?.trim() || "Uncategorized";
}

function sortItemsForOrder(items: ShopItemRead[]) {
  return [...items].sort((left, right) => {
    const leftSort = left.sort_order ?? Number.MAX_SAFE_INTEGER;
    const rightSort = right.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (leftSort !== rightSort) {
      return leftSort - rightSort;
    }
    return left.name.localeCompare(right.name);
  });
}

function buildOrderGroups(items: ShopItemRead[]): OrderGroup[] {
  const groups: OrderGroup[] = [];
  const groupIndexes = new Map<string, number>();

  for (const item of sortItemsForOrder(items)) {
    const key = getOrderCategoryKey(item);
    const existingIndex = groupIndexes.get(key);
    if (existingIndex !== undefined) {
      groups[existingIndex].items.push(item);
      continue;
    }
    groupIndexes.set(key, groups.length);
    groups.push({
      key,
      label: getOrderCategoryLabel(item),
      items: [item],
    });
  }

  return groups;
}

async function fetchAllSelectedItems(shopId: UUID) {
  const items: ShopItemRead[] = [];
  let params: FetchShopItemsParams = { limit: PAGE_LIMIT };

  while (true) {
    const page = await fetchSelectedShopItemsPage(shopId, params);
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

function ActionButton({
  label,
  icon,
  palette,
  tone = "primary",
  disabled = false,
  loading = false,
  onPress,
}: {
  label: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>["name"];
  palette: ThemePalette;
  tone?: "primary" | "neutral" | "danger" | "success" | "warning" | "info";
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  let fg = disabled ? palette.onShellMuted : palette.onPrimary;
  let bg = disabled ? palette.shellControl : palette.primary;
  let border = disabled ? palette.shellBorder : palette.primary;

  if (!disabled) {
    if (tone === "danger") {
      bg = palette.danger;
      border = palette.danger;
    } else if (tone === "success") {
      bg = palette.success;
      border = palette.success;
    } else if (tone === "warning") {
      bg = palette.warning;
      border = palette.warning;
      fg = palette.onCash;
    } else if (tone === "info") {
      bg = palette.primaryStrong;
      border = palette.primaryStrong;
    } else if (tone === "primary") {
      bg = palette.primary;
      border = palette.primary;
    }
  }

  return (
    <TButton
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      minHeight={42}
      borderRadius={10}
      paddingHorizontal={12}
      borderWidth={1}
      borderColor={border}
      backgroundColor={bg}
      opacity={disabled ? 0.55 : 1}
      pressStyle={{ opacity: 0.9, scale: 0.99 }}
    >
      {loading ? (
        <Spinner color={fg} size="small" />
      ) : (
        <XStack alignItems="center" justifyContent="center" gap={6}>
          <MaterialCommunityIcons
            name={icon}
            size={17}
            color={fg}
          />
          <Text
            numberOfLines={1}
            style={[styles.actionButtonText, { color: fg }]}
          >
            {label}
          </Text>
        </XStack>
      )}
    </TButton>
  );
}

function OrderItemRow({
  item,
  drag,
  isActive,
  palette,
}: RenderItemParams<ShopItemRead> & { palette: ThemePalette }) {
  const imageUri = getItemThumbnailUri(item);
  const unitLabel = `${item.unit_type === UnitType.WEIGHT ? "Weight" : "Count"} · ${item.base_unit.toUpperCase()}`;

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
          borderColor: isActive ? palette.items : palette.border,
          backgroundColor: isActive ? palette.itemsSoft : palette.card,
        },
      ]}
    >
      <ItemThumbnail
        uri={imageUri}
        recyclingKey={item.id}
        size={44}
        borderRadius={10}
        backgroundColor={palette.surfaceMuted}
        iconColor={palette.textMuted}
        iconSize={19}
      />
      <View style={styles.orderText}>
        <Text numberOfLines={1} style={[styles.orderName, { color: palette.textPrimary }]}>
          {item.name}
        </Text>
        <Text numberOfLines={1} style={[styles.orderTamilName, { color: palette.textSecondary }]}>
          {item.tamil_name || "Tamil missing"}
        </Text>
        <Text numberOfLines={1} style={[styles.orderMeta, { color: palette.textMuted }]}>
          {unitLabel}
        </Text>
      </View>
      <MaterialCommunityIcons name="drag-horizontal-variant" size={22} color={palette.textMuted} />
    </Pressable>
  );
}

export function AdminShopItemsOrderScreen({
  navigation,
  route,
}: AdminShopItemsOrderScreenProps) {
  const { colorScheme, palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const { shopId, shopName } = route.params;
  const [groups, setGroups] = useState<OrderGroup[]>([]);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeGroup = useMemo(
    () => groups.find((group) => group.key === activeGroupKey) ?? groups[0] ?? null,
    [activeGroupKey, groups],
  );
  const itemCount = useMemo(
    () => groups.reduce((total, group) => total + group.items.length, 0),
    [groups],
  );

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchAllSelectedItems(shopId);
      const nextGroups = buildOrderGroups(items);
      setGroups(nextGroups);
      setActiveGroupKey(nextGroups[0]?.key ?? null);
      setDirty(false);
    } catch (requestError) {
      setError(formatApiErrorMessage(requestError, "Unable to load shop items."));
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!activeGroupKey || groups.some((group) => group.key === activeGroupKey)) {
      return;
    }
    setActiveGroupKey(groups[0]?.key ?? null);
  }, [activeGroupKey, groups]);

  const saveOrder = useCallback(() => {
    const itemIds = groups.flatMap((group) => group.items.map((item) => item.id));
    if (itemIds.length === 0) {
      navigation.goBack();
      return;
    }

    setSaving(true);
    setError(null);
    void updateSelectedShopItemsOrder(shopId, { item_ids: itemIds })
      .then(() => {
        setDirty(false);
        navigation.navigate("AdminShopItems", { shopId });
      })
      .catch((requestError) => {
        triggerHaptic();
        setError(formatApiErrorMessage(requestError, "Unable to save item order."));
      })
      .finally(() => setSaving(false));
  }, [groups, navigation, shopId]);

  const renderItem = useCallback(
    (params: RenderItemParams<ShopItemRead>) => (
      <OrderItemRow {...params} palette={palette} />
    ),
    [palette],
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View
        style={[
          styles.topBar,
          { backgroundColor: palette.shell, borderBottomColor: palette.shellBorder, paddingTop: Math.max(insets.top - 8, 0) },
        ]}
      >
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text numberOfLines={1} style={[styles.title, { color: palette.onShell }]}>
            Arrange order
          </Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: palette.onShellMuted }]}>
            {(shopName || "Selected shop")} · {itemCount} items
          </Text>
        </View>
        <AdminHeaderActions
          refreshing={loading}
          refreshDisabled={saving}
          onRefresh={loadItems}
        />
        <ActionButton
          label="Save order"
          icon="content-save-outline"
          palette={palette}
          tone="primary"
          disabled={!dirty || saving || loading}
          loading={saving}
          onPress={saveOrder}
        />
      </View>

      <View style={styles.header}>
        <ErrorState message={error} palette={palette} onRetry={() => void loadItems()} />
        {groups.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryChips}
          >
            {groups.map((group) => {
              const selected = group.key === activeGroup?.key;
              return (
                <Pressable
                  key={group.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setActiveGroupKey(group.key)}
                  style={[
                    styles.categoryChip,
                    {
                      borderColor: selected ? palette.items : palette.border,
                      backgroundColor: selected ? palette.itemsSoft : palette.card,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={selected ? "tag-check-outline" : "tag-outline"}
                    size={15}
                    color={selected ? palette.itemsStrong : palette.textMuted}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.categoryChipText,
                      { color: selected ? palette.itemsStrong : palette.textPrimary },
                    ]}
                  >
                    {group.label}
                  </Text>
                  <Text style={[styles.categoryChipCount, { color: palette.textMuted }]}>
                    {group.items.length}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      <DraggableFlatList
        data={loading ? [] : activeGroup?.items ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onDragEnd={({ data }) => {
          if (!activeGroup) {
            return;
          }
          setGroups((current) =>
            current.map((group) => (group.key === activeGroup.key ? { ...group, items: data } : group)),
          );
          setDirty(true);
        }}
        activationDistance={8}
        containerStyle={{ flex: 1, backgroundColor: palette.background }}
        contentContainerStyle={{ padding: 16, paddingBottom: 42 + insets.bottom, gap: 8 }}
        ListEmptyComponent={
          loading ? (
            <YStack gap={8}>
              <View style={[styles.loadingRow, { borderColor: palette.border, backgroundColor: palette.card }]} />
              <View style={[styles.loadingRow, { borderColor: palette.border, backgroundColor: palette.card }]} />
              <View style={[styles.loadingRow, { borderColor: palette.border, backgroundColor: palette.card }]} />
            </YStack>
          ) : (
            <EmptyState
              title="No selected items"
              message="Import catalogue items to arrange this shop."
              icon="playlist-remove"
              palette={palette}
            />
          )
        }
      />
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
  actionButtonText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    flexShrink: 1,
  },
  header: {
    padding: 16,
    paddingBottom: 0,
    gap: 12,
  },
  categoryChips: {
    gap: 8,
    paddingRight: 14,
  },
  categoryChip: {
    minHeight: 38,
    maxWidth: 180,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  categoryChipText: {
    minWidth: 0,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    flexShrink: 1,
  },
  categoryChipCount: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
  },
  orderRow: {
    minHeight: 70,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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
  loadingRow: {
    height: 70,
    borderWidth: 1,
    borderRadius: 12,
  },
});
