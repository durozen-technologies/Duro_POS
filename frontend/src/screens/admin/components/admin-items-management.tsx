import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo, useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button as TButton, Input, Spinner, XStack, YStack } from "tamagui";

import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import type {
  DailyPriceCreate,
  ItemPriceRead,
  ShopItemCounts,
  ShopItemRead,
  ShopRead,
  UUID,
} from "@/types/api";
import { isPositiveNumber, toMoneyString } from "@/utils/decimal";
import { getItemThumbnailUri } from "@/utils/item-images";

import { adminShadow, type ThemePalette } from "../admin-dashboard-theme";
import {
  AdminItemWorkspace,
  ItemScope,
} from "../admin-items-model";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

export type RowAction = {
  label: string;
  icon: IconName;
  tone?: "primary" | "neutral" | "danger";
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
};

export type ShopItemsTab = "selected" | "available";

function buttonColors(palette: ThemePalette, tone: "primary" | "neutral" | "danger" = "neutral", active = false) {
  if (tone === "danger") {
    return {
      fg: palette.danger,
      bg: active ? palette.dangerSoft : palette.card,
      border: palette.danger,
    };
  }
  if (tone === "primary") {
    return {
      fg: active ? "#FFFFFF" : palette.emeraldDark,
      bg: active ? palette.emerald : palette.emeraldSoft,
      border: palette.emerald,
    };
  }
  return {
    fg: palette.textPrimary,
    bg: palette.card,
    border: palette.border,
  };
}

function ActionButton({
  label,
  icon,
  palette,
  tone = "neutral",
  active = false,
  disabled = false,
  loading = false,
  compact = false,
  onPress,
}: {
  label: string;
  icon: IconName;
  palette: ThemePalette;
  tone?: "primary" | "neutral" | "danger";
  active?: boolean;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  onPress: () => void;
}) {
  const colors = buttonColors(palette, tone, active || tone === "primary");
  return (
    <TButton
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      minHeight={compact ? 36 : 42}
      borderRadius={10}
      paddingHorizontal={compact ? 9 : 12}
      borderWidth={1}
      borderColor={colors.border}
      backgroundColor={colors.bg}
      opacity={disabled ? 0.55 : 1}
      pressStyle={{ opacity: 0.9, scale: 0.99 }}
    >
      {loading ? (
        <Spinner color={colors.fg} size="small" />
      ) : (
        <XStack alignItems="center" justifyContent="center" gap={6}>
          <MaterialCommunityIcons name={icon} size={compact ? 15 : 17} color={colors.fg} />
          <Text numberOfLines={1} style={[styles.buttonText, { color: colors.fg }]}>
            {label}
          </Text>
        </XStack>
      )}
    </TButton>
  );
}

export function StatusPill({
  label,
  icon,
  palette,
  tone = "neutral",
}: {
  label: string;
  icon?: IconName;
  palette: ThemePalette;
  tone?: "primary" | "neutral" | "danger";
}) {
  const colors = buttonColors(palette, tone, false);
  return (
    <View style={[styles.pill, { borderColor: colors.border, backgroundColor: colors.bg }]}>
      {icon ? <MaterialCommunityIcons name={icon} size={13} color={colors.fg} /> : null}
      <Text numberOfLines={1} style={[styles.pillText, { color: colors.fg }]}>
        {label}
      </Text>
    </View>
  );
}

export function EmptyState({
  title,
  message,
  icon,
  action,
  palette,
}: {
  title: string;
  message: string;
  icon: IconName;
  action?: RowAction;
  palette: ThemePalette;
}) {
  return (
    <View style={[styles.empty, { borderColor: palette.border, backgroundColor: palette.card }]}>
      <View style={[styles.emptyIcon, { backgroundColor: palette.surfaceMuted }]}>
        <MaterialCommunityIcons name={icon} size={28} color={palette.textMuted} />
      </View>
      <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>{title}</Text>
      <Text style={[styles.emptyText, { color: palette.textMuted }]}>{message}</Text>
      {action ? (
        <ActionButton
          label={action.label}
          icon={action.icon}
          palette={palette}
          tone={action.tone ?? "primary"}
          onPress={action.onPress}
        />
      ) : null}
    </View>
  );
}

export function ErrorState({
  message,
  palette,
  onRetry,
}: {
  message: string | null;
  palette: ThemePalette;
  onRetry?: () => void;
}) {
  if (!message) {
    return null;
  }
  return (
    <View style={[styles.error, { borderColor: palette.danger, backgroundColor: palette.dangerSoft }]}>
      <MaterialCommunityIcons name="alert-circle-outline" size={18} color={palette.danger} />
      <Text style={[styles.errorText, { color: palette.danger }]}>{message}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={10}>
          <Text style={[styles.errorAction, { color: palette.danger }]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function WorkspaceTabs({
  workspace,
  palette,
  onCatalogue,
  onShopItems,
  onPrices,
}: {
  workspace: AdminItemWorkspace;
  palette: ThemePalette;
  onCatalogue: () => void;
  onShopItems: () => void;
  onPrices: () => void;
}) {
  const items: { value: AdminItemWorkspace; label: string; icon: IconName; onPress: () => void }[] = [
    { value: AdminItemWorkspace.Catalogue, label: "Catalogue", icon: "shape-outline", onPress: onCatalogue },
    { value: AdminItemWorkspace.Shop, label: "Shop items", icon: "storefront-outline", onPress: onShopItems },
    { value: AdminItemWorkspace.Prices, label: "Prices", icon: "cash-edit", onPress: onPrices },
  ];
  return (
    <View style={[styles.tabs, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
      {items.map((item) => {
        const active = item.value === workspace;
        return (
          <Pressable
            key={item.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={item.onPress}
            style={[
              styles.tab,
              {
                backgroundColor: active ? palette.card : "transparent",
              },
            ]}
          >
            <MaterialCommunityIcons
              name={item.icon}
              size={16}
              color={active ? palette.emeraldDark : palette.textMuted}
            />
            <Text
              numberOfLines={1}
              style={[styles.tabText, { color: active ? palette.emeraldDark : palette.textMuted }]}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ShopPicker({
  shops,
  selectedShop,
  loading,
  palette,
  eyebrow = "Active shop",
  sheetSubtitle = "Search and switch the active item workspace.",
  onSelectShop,
}: {
  shops: ShopRead[];
  selectedShop: ShopRead | null;
  loading: boolean;
  palette: ThemePalette;
  eyebrow?: string;
  sheetSubtitle?: string;
  onSelectShop: (shopId: UUID) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filteredShops = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return shops;
    }
    return shops.filter((shop) => shop.name.toLowerCase().includes(normalized));
  }, [query, shops]);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={[styles.shopPicker, { borderColor: palette.border, backgroundColor: palette.card }]}
      >
        <View style={styles.shopPickerText}>
          <Text style={[styles.eyebrow, { color: palette.textMuted }]}>{eyebrow}</Text>
          <Text numberOfLines={1} style={[styles.shopName, { color: palette.textPrimary }]}>
            {loading ? "Loading shops..." : selectedShop?.name ?? "Select a shop"}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-down" size={22} color={palette.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={[styles.modalOverlay, styles.centeredModalOverlay, { backgroundColor: palette.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={[styles.shopSheet, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <XStack alignItems="center" justifyContent="space-between" gap={10}>
              <YStack flex={1} minWidth={0}>
                <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>Select shop</Text>
                <Text style={[styles.sheetSubtitle, { color: palette.textMuted }]}>
                  {sheetSubtitle}
                </Text>
              </YStack>
              <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.iconButton}>
                <MaterialCommunityIcons name="close" size={20} color={palette.textPrimary} />
              </Pressable>
            </XStack>
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Search shops"
              placeholderTextColor={palette.textMuted as never}
              minHeight={44}
              borderRadius={10}
              borderWidth={1}
              borderColor={palette.border}
              backgroundColor={palette.surfaceMuted}
              color={palette.textPrimary}
              fontSize={14}
              fontWeight="700"
            />
            <FlatList
              data={filteredShops}
              keyExtractor={(shop) => shop.id}
              style={{ maxHeight: 360 }}
              ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
              renderItem={({ item }) => {
                const selected = item.id === selectedShop?.id;
                return (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      onSelectShop(item.id);
                      setOpen(false);
                    }}
                    style={[
                      styles.shopOption,
                      {
                        borderColor: selected ? palette.emerald : palette.border,
                        backgroundColor: selected ? palette.emeraldSoft : palette.surfaceMuted,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={selected ? "store-check-outline" : "storefront-outline"}
                      size={18}
                      color={selected ? palette.emeraldDark : palette.textSecondary}
                    />
                    <Text numberOfLines={1} style={[styles.shopOptionText, { color: palette.textPrimary }]}>
                      {item.name}
                    </Text>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <EmptyState
                  title="No shops found"
                  message="Change the search text or create a shop first."
                  icon="store-search-outline"
                  palette={palette}
                />
              }
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

export function FilterBar({
  workspace,
  search,
  palette,
  onChangeSearch,
  onCreate,
}: {
  workspace: AdminItemWorkspace.Catalogue | AdminItemWorkspace.Shop;
  search: string;
  palette: ThemePalette;
  onChangeSearch: (value: string) => void;
  onCreate: () => void;
}) {
  return (
    <YStack gap={10}>
      <XStack gap={8} alignItems="center">
        <View style={[styles.searchWrap, { borderColor: palette.border, backgroundColor: palette.card }]}>
          <MaterialCommunityIcons name="magnify" size={18} color={palette.textMuted} />
          <Input
            value={search}
            onChangeText={onChangeSearch}
            placeholder="Search English or Tamil"
            placeholderTextColor={palette.textMuted as never}
            flex={1}
            borderWidth={0}
            paddingHorizontal={0}
            backgroundColor="transparent"
            color={palette.textPrimary}
            fontSize={14}
            fontWeight="700"
          />
        </View>
        <ActionButton
          label={workspace === AdminItemWorkspace.Catalogue ? "Add" : "Import"}
          icon={workspace === AdminItemWorkspace.Catalogue ? "plus" : "tray-arrow-down"}
          palette={palette}
          tone="primary"
          onPress={onCreate}
        />
      </XStack>
    </YStack>
  );
}

export function ShopItemsInlineTabs({
  activeTab,
  selectedCount,
  availableCount,
  palette,
  onChangeTab,
}: {
  activeTab: ShopItemsTab;
  selectedCount: number;
  availableCount: number | null;
  palette: ThemePalette;
  onChangeTab: (tab: ShopItemsTab) => void;
}) {
  const tabs: { value: ShopItemsTab; label: string; icon: IconName; count: number | null }[] = [
    { value: "selected", label: "Selected items", icon: "playlist-check", count: selectedCount },
    { value: "available", label: "Available catalogue", icon: "playlist-plus", count: availableCount },
  ];

  return (
    <View style={[styles.inlineTabs, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
      {tabs.map((tab) => {
        const active = tab.value === activeTab;
        return (
          <Pressable
            key={tab.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChangeTab(tab.value)}
            style={[styles.inlineTab, { backgroundColor: active ? palette.card : "transparent" }]}
          >
            <MaterialCommunityIcons
              name={tab.icon}
              size={16}
              color={active ? palette.emeraldDark : palette.textMuted}
            />
            <Text
              numberOfLines={1}
              style={[styles.inlineTabText, { color: active ? palette.emeraldDark : palette.textMuted }]}
            >
              {tab.label}
            </Text>
            <Text style={[styles.inlineTabCount, { color: active ? palette.emeraldDark : palette.textMuted }]}>
              {tab.count ?? "..."}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ImportCatalogueToolbar({
  search,
  selectedCount,
  importing,
  palette,
  onChangeSearch,
  onImportSelected,
  onClearSelection,
  onDone,
}: {
  search: string;
  selectedCount: number;
  importing: boolean;
  palette: ThemePalette;
  onChangeSearch: (value: string) => void;
  onImportSelected: () => void;
  onClearSelection: () => void;
  onDone: () => void;
}) {
  return (
    <YStack gap={10}>
      <XStack gap={8} alignItems="center">
        <View style={[styles.searchWrap, { borderColor: palette.border, backgroundColor: palette.card }]}>
          <MaterialCommunityIcons name="magnify" size={18} color={palette.textMuted} />
          <Input
            value={search}
            onChangeText={onChangeSearch}
            placeholder="Search available catalogue"
            placeholderTextColor={palette.textMuted as never}
            flex={1}
            borderWidth={0}
            paddingHorizontal={0}
            backgroundColor="transparent"
            color={palette.textPrimary}
            fontSize={14}
            fontWeight="700"
          />
        </View>
        <ActionButton
          label="Done"
          icon="check"
          palette={palette}
          tone="neutral"
          disabled={importing}
          onPress={onDone}
        />
      </XStack>
      <View style={[styles.importSelectionBar, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
        <Text numberOfLines={1} style={[styles.importSelectionText, { color: palette.textPrimary }]}>
          {selectedCount === 0 ? "Select items to import" : `${selectedCount} selected`}
        </Text>
        <XStack gap={8} flexShrink={0}>
          {selectedCount > 0 ? (
            <ActionButton
              label="Clear"
              icon="close-circle-outline"
              palette={palette}
              tone="neutral"
              disabled={importing}
              compact
              onPress={onClearSelection}
            />
          ) : null}
          <ActionButton
            label="Import selected"
            icon="tray-arrow-down"
            palette={palette}
            tone="primary"
            disabled={selectedCount === 0}
            loading={importing && selectedCount > 0}
            compact
            onPress={onImportSelected}
          />
        </XStack>
      </View>
    </YStack>
  );
}

export function StatsStrip({
  counts,
  totalCount,
  palette,
}: {
  counts: ShopItemCounts | null;
  totalCount: number;
  palette: ThemePalette;
}) {
  const stats = [
    { label: "Total", value: totalCount || counts?.all || 0, icon: "format-list-bulleted" as IconName, tone: "primary" as const },
  ];
  return (
    <View style={styles.statsStrip}>
      {stats.map((stat) => {
        const colors = buttonColors(palette, stat.tone, false);
        return (
          <View
            key={stat.label}
            style={[styles.statCell, { borderColor: colors.border, backgroundColor: colors.bg }]}
          >
            <MaterialCommunityIcons name={stat.icon} size={15} color={colors.fg} />
            <Text style={[styles.statValue, { color: palette.textPrimary }]}>{stat.value}</Text>
            <Text numberOfLines={1} style={[styles.statLabel, { color: palette.textMuted }]}>
              {stat.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function rowActionChanged(previous?: RowAction, next?: RowAction) {
  return (
    previous?.label !== next?.label ||
    previous?.icon !== next?.icon ||
    previous?.tone !== next?.tone ||
    previous?.disabled !== next?.disabled ||
    previous?.loading !== next?.loading
  );
}

export const ItemRow = memo(function ItemRow({
  item,
  palette,
  primaryAction,
  secondaryActions,
}: {
  item: ShopItemRead;
  palette: ThemePalette;
  primaryAction: RowAction;
  secondaryActions: RowAction[];
}) {
  const imageUri = getItemThumbnailUri(item);
  const unitLabel = `${item.unit_type === "weight" ? "Weight" : "Count"} · ${item.base_unit.toUpperCase()}`;
  const categoryLabel = item.category?.trim() ? item.category.trim() : "Uncategorized";

  return (
    <View style={[styles.itemRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
      <View style={styles.itemMain}>
        <ItemThumbnail
          uri={imageUri}
          recyclingKey={item.id}
          size={44}
          borderRadius={10}
          backgroundColor={palette.surfaceMuted}
          iconColor={palette.textMuted}
          iconSize={19}
        />
        <View style={styles.itemText}>
          <Text style={[styles.itemName, { color: palette.textPrimary }]}>
            {item.name}
          </Text>
          <Text style={[styles.itemTamilName, { color: palette.textSecondary }]}>
            {item.tamil_name || "Tamil missing"}
          </Text>
          <Text style={[styles.itemMeta, { color: palette.textMuted }]}>
            {unitLabel} · {categoryLabel}
          </Text>
        </View>
      </View>
      <View style={styles.rowActions}>
        {secondaryActions.map((action) => (
          <ActionButton
            key={action.label}
            label={action.label}
            icon={action.icon}
            palette={palette}
            tone={action.tone ?? "neutral"}
            disabled={action.disabled}
            loading={action.loading}
            onPress={action.onPress}
            compact
          />
        ))}
        <ActionButton
          label={primaryAction.label}
          icon={primaryAction.icon}
          palette={palette}
          tone={primaryAction.tone ?? "primary"}
          disabled={primaryAction.disabled}
          loading={primaryAction.loading}
          onPress={primaryAction.onPress}
          compact
        />
      </View>
    </View>
  );
}, (previous, next) => {
  if (
    previous.palette !== next.palette ||
    previous.item.id !== next.item.id ||
    previous.item.name !== next.item.name ||
    previous.item.tamil_name !== next.item.tamil_name ||
    previous.item.updated_at !== next.item.updated_at ||
    previous.item.image_path !== next.item.image_path ||
    previous.item.image_thumb_path !== next.item.image_thumb_path ||
    previous.item.is_active !== next.item.is_active ||
    previous.item.allocated !== next.item.allocated ||
    previous.secondaryActions.length !== next.secondaryActions.length ||
    rowActionChanged(previous.primaryAction, next.primaryAction)
  ) {
    return false;
  }

  return previous.secondaryActions.every(
    (action, index) => !rowActionChanged(action, next.secondaryActions[index]),
  );
});

export function ItemList({
  items,
  loading,
  refreshing,
  loadingMore,
  hasMore,
  emptyTitle,
  emptyMessage,
  emptyAction,
  palette,
  onRefresh,
  onLoadMore,
  renderItem,
  header,
  bottomPadding,
  extraData,
}: {
  items: ShopItemRead[];
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  emptyTitle: string;
  emptyMessage: string;
  emptyAction?: RowAction;
  palette: ThemePalette;
  onRefresh: () => void;
  onLoadMore: () => void;
  renderItem: (item: ShopItemRead) => React.ReactElement;
  header: React.ReactElement;
  bottomPadding: number;
  extraData?: unknown;
}) {
  return (
    <FlatList
      data={loading && items.length === 0 ? [] : items}
      extraData={extraData}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => renderItem(item)}
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      updateCellsBatchingPeriod={40}
      windowSize={7}
      removeClippedSubviews
      ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{ padding: 14, paddingBottom: bottomPadding, gap: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.emerald} />}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View style={styles.listHeader}>{header}</View>}
      ListEmptyComponent={
        loading ? (
          <YStack gap={8}>
            <LoadingRow palette={palette} />
            <LoadingRow palette={palette} />
            <LoadingRow palette={palette} />
          </YStack>
        ) : (
          <EmptyState
            title={emptyTitle}
            message={emptyMessage}
            icon="playlist-remove"
            action={emptyAction}
            palette={palette}
          />
        )
      }
      ListFooterComponent={
        hasMore ? (
          <ActionButton
            label="Load more"
            icon="chevron-down-circle-outline"
            palette={palette}
            tone="neutral"
            loading={loadingMore}
            onPress={onLoadMore}
          />
        ) : null
      }
    />
  );
}

function LoadingRow({ palette }: { palette: ThemePalette }) {
  return (
    <View style={[styles.loadingRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
      <View style={[styles.loadingThumb, { backgroundColor: palette.surfaceMuted }]} />
      <YStack flex={1} gap={8}>
        <View style={[styles.loadingLineWide, { backgroundColor: palette.surfaceMuted }]} />
        <View style={[styles.loadingLineNarrow, { backgroundColor: palette.surfaceMuted }]} />
      </YStack>
      <View style={[styles.loadingButton, { backgroundColor: palette.surfaceMuted }]} />
    </View>
  );
}

const PriceRow = memo(function PriceRow({
  item,
  value,
  dirty,
  valid,
  saving,
  palette,
  onChangeDraftPrice,
  onSaveRow,
}: {
  item: ItemPriceRead;
  value: string;
  dirty: boolean;
  valid: boolean;
  saving: boolean;
  palette: ThemePalette;
  onChangeDraftPrice: (itemId: UUID, value: string) => void;
  onSaveRow: (item: ItemPriceRead, value: string) => void;
}) {
  const imageUri = getItemThumbnailUri(item);
  return (
    <View style={[styles.priceRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
      <ItemThumbnail
        uri={imageUri}
        recyclingKey={item.item_id}
        size={44}
        borderRadius={10}
        backgroundColor={palette.surfaceMuted}
        iconColor={palette.textMuted}
        iconSize={19}
      />
      <View style={styles.priceText}>
        <Text style={[styles.itemName, { color: palette.textPrimary }]}>
          {item.item_name}
        </Text>
        <Text style={[styles.itemTamilName, { color: palette.textSecondary }]}>
          {item.item_tamil_name ?? "Tamil missing"}
        </Text>
        <Text style={[styles.itemMeta, { color: palette.textMuted }]}>
          {item.base_unit.toUpperCase()}
        </Text>
      </View>
      <View style={styles.priceEdit}>
        <Input
          value={value}
          onChangeText={(nextValue) => onChangeDraftPrice(item.item_id, nextValue)}
          placeholder="0.00"
          placeholderTextColor={palette.textMuted as never}
          keyboardType="decimal-pad"
          minHeight={40}
          borderRadius={10}
          borderWidth={1}
          borderColor={valid || !value ? palette.border : palette.danger}
          backgroundColor={palette.surfaceMuted}
          color={palette.textPrimary}
          fontSize={15}
          fontWeight="900"
          textAlign="right"
        />
        <ActionButton
          label="Save"
          icon="cash-check"
          palette={palette}
          tone={dirty ? "primary" : "neutral"}
          compact
          disabled={!valid || !dirty}
          loading={saving}
          onPress={() => onSaveRow(item, value)}
        />
      </View>
    </View>
  );
}, (previous, next) => (
  previous.item.item_id === next.item.item_id &&
  previous.item.item_name === next.item.item_name &&
  previous.item.item_tamil_name === next.item.item_tamil_name &&
  previous.item.unit_type === next.item.unit_type &&
  previous.item.base_unit === next.item.base_unit &&
  previous.item.current_price === next.item.current_price &&
  previous.item.latest_price_date === next.item.latest_price_date &&
  previous.item.price_status === next.item.price_status &&
  previous.item.image_path === next.item.image_path &&
  previous.item.image_thumb_path === next.item.image_thumb_path &&
  previous.value === next.value &&
  previous.dirty === next.dirty &&
  previous.valid === next.valid &&
  previous.saving === next.saving &&
  previous.palette === next.palette
));

export function PriceGrid({
  items,
  loading,
  refreshing,
  draftPrices,
  savingAll,
  savingItemId,
  error,
  selectedShop,
  palette,
  bottomPadding,
  onRefresh,
  onBackToItems,
  onChangeDraftPrice,
  onSaveRow,
  onSaveEdited,
  onCompleteToday,
}: {
  items: ItemPriceRead[];
  loading: boolean;
  refreshing: boolean;
  draftPrices: Record<UUID, string>;
  savingAll: boolean;
  savingItemId: UUID | null;
  error: string | null;
  selectedShop: ShopRead | null;
  palette: ThemePalette;
  bottomPadding: number;
  onRefresh: () => void;
  onBackToItems: () => void;
  onChangeDraftPrice: (itemId: UUID, value: string) => void;
  onSaveRow: (item: ItemPriceRead, value: string) => void;
  onSaveEdited: (entries: DailyPriceCreate["entries"]) => void;
  onCompleteToday: (entries: DailyPriceCreate["entries"], staleCarryCount: number) => void;
}) {
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.item_id, item])),
    [items],
  );
  const priceState = useMemo(() => {
    const dirtyEntries: DailyPriceCreate["entries"] = [];
    const completeEntries: DailyPriceCreate["entries"] = [];
    let dirtyCount = 0;
    let invalidDirtyCount = 0;
    let incompleteCount = 0;

    for (const [itemId, draftValue] of Object.entries(draftPrices)) {
      const item = itemsById.get(itemId);
      if (!item) {
        continue;
      }
      const currentValue = item.current_price ?? "";
      if (draftValue === currentValue) {
        continue;
      }
      dirtyCount += 1;
      if (!isPositiveNumber(draftValue)) {
        invalidDirtyCount += 1;
        continue;
      }
      dirtyEntries.push({
        item_id: item.item_id,
        price_per_unit: toMoneyString(draftValue),
      });
    }

    for (const item of items) {
      const value = (draftPrices[item.item_id] ?? item.current_price ?? "").trim();
      if (!isPositiveNumber(value)) {
        incompleteCount += 1;
        continue;
      }
      completeEntries.push({
        item_id: item.item_id,
        price_per_unit: toMoneyString(value),
      });
    }

    return {
      completeEntries,
      dirtyEntries,
      dirtyCount,
      incompleteCount,
      invalidDirtyCount,
    };
  }, [draftPrices, items, itemsById]);

  const completeToday = useCallback(() => {
    if (priceState.incompleteCount > 0) {
      return;
    }
    onCompleteToday(priceState.completeEntries, 0);
  }, [onCompleteToday, priceState.completeEntries, priceState.incompleteCount]);
  const priceSummaryText = `${selectedShop?.name ?? "Select a shop"} · ${items.length} items · ${priceState.dirtyCount} unsaved${
    priceState.incompleteCount > 0 ? ` · ${priceState.incompleteCount} need price` : ""
  }`;

  const renderPriceRow = useCallback(({ item }: { item: ItemPriceRead }) => {
    const draftValue = draftPrices[item.item_id];
    const currentValue = item.current_price ?? "";
    const value = draftValue ?? currentValue;
    const dirty = draftValue !== undefined && draftValue !== currentValue;
    const valid = isPositiveNumber(value);
    return (
      <PriceRow
        item={item}
        value={value}
        dirty={dirty}
        valid={valid}
        saving={savingItemId === item.item_id}
        palette={palette}
        onChangeDraftPrice={onChangeDraftPrice}
        onSaveRow={onSaveRow}
      />
    );
  }, [draftPrices, onChangeDraftPrice, onSaveRow, palette, savingItemId]);
  const priceListExtraData = useMemo(() => ({ draftPrices, savingItemId }), [draftPrices, savingItemId]);

  return (
    <FlatList
      data={loading ? [] : items}
      extraData={priceListExtraData}
      keyExtractor={(item) => item.item_id}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      updateCellsBatchingPeriod={40}
      windowSize={7}
      removeClippedSubviews
      ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{ padding: 14, paddingBottom: bottomPadding, gap: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.emerald} />}
      ListHeaderComponent={
        <YStack gap={12} marginBottom={4}>
          <ErrorState message={error} palette={palette} onRetry={onRefresh} />
          <View style={[styles.priceSummary, { borderColor: palette.border, backgroundColor: palette.card }]}>
            <XStack alignItems="center" justifyContent="space-between" gap={10}>
              <YStack flex={1} minWidth={0}>
                <Text numberOfLines={1} style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                  Daily prices
                </Text>
                <Text numberOfLines={1} style={[styles.sectionSubtitle, { color: palette.textMuted }]}>
                  {priceSummaryText}
                </Text>
              </YStack>
              <ActionButton
                label="Items"
                icon="arrow-left"
                palette={palette}
                tone="neutral"
                onPress={onBackToItems}
                compact
              />
            </XStack>
            <XStack gap={8} flexWrap="wrap">
              <ActionButton
                label={savingAll ? "Saving..." : "Save edited prices"}
                icon="content-save-outline"
                palette={palette}
                tone="primary"
                loading={savingAll}
                disabled={priceState.dirtyCount === 0 || priceState.invalidDirtyCount > 0}
                onPress={() => onSaveEdited(priceState.dirtyEntries)}
              />
              <ActionButton
                label="Complete today"
                icon="calendar-check-outline"
                palette={palette}
                tone="neutral"
                disabled={items.length === 0 || priceState.incompleteCount > 0 || savingAll}
                onPress={completeToday}
              />
            </XStack>
          </View>
        </YStack>
      }
      renderItem={renderPriceRow}
      ListEmptyComponent={
        loading ? (
          <YStack gap={8}>
            <LoadingRow palette={palette} />
            <LoadingRow palette={palette} />
            <LoadingRow palette={palette} />
          </YStack>
        ) : (
          <EmptyState
            title="No allocated items"
            message="Allocate items to this shop before setting daily prices."
            icon="link-variant-off"
            action={{ label: "Back to items", icon: "arrow-left", onPress: onBackToItems }}
            palette={palette}
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  buttonText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    flexShrink: 1,
  },
  empty: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 18,
    alignItems: "center",
    gap: 10,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  error: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  errorAction: {
    fontSize: 12,
    fontWeight: "900",
  },
  tabs: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 4,
    flexDirection: "row",
    gap: 4,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 6,
  },
  tabText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    flexShrink: 1,
  },
  inlineTabs: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 4,
    flexDirection: "row",
    gap: 4,
  },
  inlineTab: {
    flex: 1,
    minHeight: 40,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 6,
  },
  inlineTabText: {
    minWidth: 0,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    flexShrink: 1,
  },
  inlineTabCount: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
  },
  shopPicker: {
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  shopPickerText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  shopName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 12,
  },
  centeredModalOverlay: {
    justifyContent: "center",
  },
  shopSheet: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 12,
    ...adminShadow("#000000", 0.22, 18, 18),
  },
  actionSheet: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 12,
    maxHeight: "82%",
    ...adminShadow("#000000", 0.22, 18, 18),
  },
  actionSheetScroll: {
    flexGrow: 0,
    maxHeight: 360,
  },
  actionSheetContent: {
    gap: 8,
  },
  actionSheetOption: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  actionSheetOptionText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
  },
  actionSheetEmpty: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  actionSheetCancel: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  actionSheetCancelText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
  },
  confirmIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
  },
  sheetSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  shopOption: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  shopOptionText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  importSelectionBar: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  importSelectionText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "900",
  },
  searchWrap: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingLeft: 11,
    paddingRight: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  filterScroll: {
    gap: 7,
    paddingRight: 8,
  },
  filterChip: {
    minHeight: 34,
    maxWidth: 148,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  filterText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    flexShrink: 1,
  },
  filterCount: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
  },
  statsStrip: {
    flexDirection: "row",
    gap: 8,
  },
  statCell: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 12,
    padding: 9,
    gap: 3,
  },
  statValue: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "900",
  },
  statLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  itemRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  itemMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  itemText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  rowActions: {
    minWidth: 84,
    gap: 6,
    alignItems: "stretch",
  },
  itemName: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
  },
  itemTamilName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  itemMeta: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
  },
  pill: {
    maxWidth: 168,
    minHeight: 24,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  pillText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "900",
    flexShrink: 1,
  },
  menuButton: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  listHeader: {
    marginBottom: 4,
  },
  loadingRow: {
    minHeight: 68,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadingThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  loadingLineWide: {
    width: "68%",
    height: 14,
    borderRadius: 99,
  },
  loadingLineNarrow: {
    width: "48%",
    height: 11,
    borderRadius: 99,
  },
  loadingButton: {
    width: 72,
    height: 32,
    borderRadius: 10,
  },
  priceSummary: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
  },
  sectionSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  priceRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  priceText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  priceEdit: {
    width: 116,
    gap: 6,
  },
});
