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
import {
  BaseUnit,
  ItemAssumptionStatus,
  UnitType,
  type DailyPriceCreate,
  type ItemAssumptionUpdate,
  type ItemPriceRead,
  type ShopItemCounts,
  type ShopItemRead,
  type ShopRead,
  type UUID,
} from "@/types/api";
import { isPositiveNumber, toMoneyString } from "@/utils/decimal";
import { createDateTimeFormat, parseCalendarDate } from "@/utils/format";
import { getItemThumbnailUri } from "@/utils/item-images";

import { adminElevation, adminRadii, adminSpacing, type ThemePalette } from "../admin-dashboard-theme";
import {
  AdminItemWorkspace,
  ItemScope,
  PriceStatus,
} from "../admin-items-model";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

export type RowAction = {
  label: string;
  icon: IconName;
  tone?: "primary" | "neutral" | "danger" | "success" | "warning" | "info";
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
};

export type ShopItemsTab = "selected" | "available";
export type CategoryFilterOption = {
  key: string;
  label: string;
};
export type AssumptionDraft = ItemAssumptionUpdate;

const PRICE_HISTORY_WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const priceHistoryDateFormatter = createDateTimeFormat({
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const priceHistoryMonthFormatter = createDateTimeFormat({
  month: "long",
  year: "numeric",
});

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInputValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function shiftMonthValue(value: string, offset: number) {
  const date = parseDateInputValue(value);
  return toDateInputValue(new Date(date.getFullYear(), date.getMonth() + offset, 1));
}

function formatHistoryDate(value: string) {
  return priceHistoryDateFormatter.format(parseDateInputValue(value));
}

function buildHistoryCalendarDays(monthValue: string) {
  const visibleMonth = parseDateInputValue(monthValue);
  const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const days: (string | null)[] = Array.from({ length: firstDay.getDay() }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(toDateInputValue(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day)));
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

function buttonColors(palette: ThemePalette, tone: "primary" | "neutral" | "danger" | "success" | "warning" | "info" = "neutral", active = false) {
  if (tone === "danger") {
    return {
      fg: palette.danger,
      bg: active ? palette.dangerSoft : palette.card,
      border: palette.danger,
    };
  }
  if (tone === "success") {
    return {
      fg: palette.success,
      bg: active ? palette.successSoft : palette.card,
      border: palette.success,
    };
  }
  if (tone === "warning") {
    return {
      fg: palette.warning,
      bg: active ? palette.warningSoft : palette.card,
      border: palette.warning,
    };
  }
  if (tone === "info") {
    return {
      fg: palette.primaryStrong,
      bg: active ? palette.primarySoft : palette.card,
      border: palette.primaryStrong,
    };
  }
  if (tone === "primary") {
    return {
      fg: active ? palette.onPrimary : palette.primaryStrong,
      bg: active ? palette.primary : palette.primarySoft,
      border: palette.primary,
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
  tone?: "primary" | "neutral" | "danger" | "success" | "warning" | "info";
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
      flex={compact ? 1 : undefined}
      minWidth={compact ? 0 : undefined}
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
  tone?: "primary" | "neutral" | "danger" | "success" | "warning" | "info";
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
  onAssumption,
  onShopItems,
  onPrices,
}: {
  workspace: AdminItemWorkspace;
  palette: ThemePalette;
  onCatalogue: () => void;
  onAssumption: () => void;
  onShopItems: () => void;
  onPrices: () => void;
}) {
  const items: { value: AdminItemWorkspace; label: string; icon: IconName; onPress: () => void }[] = [
    { value: AdminItemWorkspace.Catalogue, label: "Catalogue", icon: "shape-outline", onPress: onCatalogue },
    { value: AdminItemWorkspace.Assumption, label: "Assumption", icon: "percent", onPress: onAssumption },
    { value: AdminItemWorkspace.Shop, label: "Shop items", icon: "storefront-outline", onPress: onShopItems },
    { value: AdminItemWorkspace.Prices, label: "Prices", icon: "cash-edit", onPress: onPrices },
  ];
  return (
    <View style={[styles.tabs, { borderColor: palette.border, backgroundColor: palette.surfaceMuted, padding: 0, gap: 0 }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ padding: 4, gap: 4 }}
      >
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
                color={active ? palette.itemsStrong : palette.textMuted}
              />
              <Text
                numberOfLines={1}
                style={[styles.tabText, { color: active ? palette.itemsStrong : palette.textMuted }]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
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
                        borderColor: selected ? palette.items : palette.border,
                        backgroundColor: selected ? palette.itemsSoft : palette.surfaceMuted,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={selected ? "store-check-outline" : "storefront-outline"}
                      size={18}
                      color={selected ? palette.itemsStrong : palette.textSecondary}
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
          tone="success"
          active
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
              color={active ? palette.itemsStrong : palette.textMuted}
            />
            <Text
              numberOfLines={1}
              style={[styles.inlineTabText, { color: active ? palette.itemsStrong : palette.textMuted }]}
            >
              {tab.label}
            </Text>
            <Text style={[styles.inlineTabCount, { color: active ? palette.itemsStrong : palette.textMuted }]}>
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
          tone="success"
          active
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
              tone="warning"
              disabled={importing}
              compact
              onPress={onClearSelection}
            />
          ) : null}
          <ActionButton
            label="Import selected"
            icon="tray-arrow-down"
            palette={palette}
            tone="success"
            active
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

export function ShopItemsCategoryToolbar({
  options,
  selectedKey,
  loading,
  palette,
  onSelectCategory,
  onArrangeOrder,
  arrangeDisabled,
}: {
  options: CategoryFilterOption[];
  selectedKey: string;
  loading: boolean;
  palette: ThemePalette;
  onSelectCategory: (key: string) => void;
  onArrangeOrder: () => void;
  arrangeDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.key === selectedKey) ?? options[0];

  return (
    <YStack gap={8}>
      <XStack gap={8} alignItems="center">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filter shop items by category"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(true)}
          style={[styles.categoryFilterButton, { borderColor: palette.border, backgroundColor: palette.card }]}
        >
          <MaterialCommunityIcons name="tag-outline" size={17} color={palette.textMuted} />
          <View style={styles.categoryFilterText}>
            <Text style={[styles.eyebrow, { color: palette.textMuted }]}>Category</Text>
            <Text numberOfLines={1} style={[styles.categoryFilterLabel, { color: palette.textPrimary }]}>
              {loading ? "Loading..." : selectedOption?.label ?? "All categories"}
            </Text>
          </View>
          <MaterialCommunityIcons name={open ? "chevron-up" : "chevron-down"} size={20} color={palette.textMuted} />
        </Pressable>
        <ActionButton
          label="Arrange order"
          icon="sort-ascending"
          palette={palette}
          tone="info"
          disabled={arrangeDisabled}
          onPress={onArrangeOrder}
        />
      </XStack>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={[styles.modalOverlay, styles.centeredModalOverlay, { backgroundColor: palette.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={[styles.categorySheet, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <XStack alignItems="center" justifyContent="space-between" gap={10}>
              <YStack flex={1} minWidth={0}>
                <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>Select category</Text>
              </YStack>
              <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.iconButton}>
                <MaterialCommunityIcons name="close" size={20} color={palette.textPrimary} />
              </Pressable>
            </XStack>
            <ScrollView
              style={styles.categoryMenuScroll}
              contentContainerStyle={styles.categoryMenuContent}
              keyboardShouldPersistTaps="handled"
            >
              {options.map((option) => {
                const selected = option.key === selectedKey;
                return (
                  <Pressable
                    key={option.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      onSelectCategory(option.key);
                      setOpen(false);
                    }}
                    style={[
                      styles.categoryMenuOption,
                      {
                        borderColor: selected ? palette.items : palette.border,
                        backgroundColor: selected ? palette.itemsSoft : palette.surfaceMuted,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={selected ? "tag-check-outline" : "tag-outline"}
                      size={17}
                      color={selected ? palette.itemsStrong : palette.textMuted}
                    />
                    <Text numberOfLines={1} style={[styles.categoryMenuText, { color: palette.textPrimary }]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  const value = totalCount || counts?.all || 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 4 }}>
      <Text style={{ fontSize: 13, fontWeight: "800", color: palette.textMuted }}>
        Total : {value}
      </Text>
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
  thumbnailSize = 44,
  actionsPlacement = "footer",
}: {
  item: ShopItemRead;
  palette: ThemePalette;
  primaryAction: RowAction;
  secondaryActions: RowAction[];
  thumbnailSize?: number;
  actionsPlacement?: "footer" | "side";
}) {
  const imageUri = getItemThumbnailUri(item);
  const unitLabel = `${item.unit_type === UnitType.WEIGHT ? "Weight" : "Count"} · ${item.base_unit.toUpperCase()}`;
  const categoryLabel = item.category?.trim() ? item.category.trim() : "Uncategorized";
  const thumbnailRadius = Math.round(thumbnailSize * 0.24);
  const thumbnailIconSize = Math.round(thumbnailSize * 0.43);
  const actionsCompact = actionsPlacement === "footer";

  return (
    <View
      style={[
        styles.itemRow,
        actionsPlacement === "side" && styles.itemRowWithSideActions,
        { borderColor: palette.border, backgroundColor: palette.card },
      ]}
    >
      <View style={[styles.itemMain, actionsPlacement === "side" && styles.itemMainWithSideActions]}>
        <ItemThumbnail
          uri={imageUri}
          recyclingKey={item.id}
          size={thumbnailSize}
          borderRadius={thumbnailRadius}
          backgroundColor={palette.surfaceMuted}
          iconColor={palette.textMuted}
          iconSize={thumbnailIconSize}
        />
        <View style={styles.itemText}>
          <Text numberOfLines={2} style={[styles.itemName, { color: palette.textPrimary }]}>
            {item.name}
          </Text>
          <Text numberOfLines={1} style={[styles.itemTamilName, { color: palette.textSecondary }]}>
            {item.tamil_name || "Tamil missing"}
          </Text>
          <Text numberOfLines={1} style={[styles.itemMeta, { color: palette.textMuted }]}>
            {unitLabel} · {categoryLabel}
          </Text>
          <View style={styles.itemStatusRow}>
            <StatusPill
              label={item.is_active ? "Active" : "Inactive"}
              icon={item.is_active ? "check-circle-outline" : "pause-circle-outline"}
              tone={item.is_active ? "success" : "warning"}
              palette={palette}
            />
          </View>
        </View>
      </View>
      <View style={actionsPlacement === "side" ? styles.rowActionsSide : styles.rowActions}>
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
            compact={actionsCompact}
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
          compact={actionsCompact}
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
    previous.thumbnailSize !== next.thumbnailSize ||
    previous.actionsPlacement !== next.actionsPlacement ||
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
      contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.items} />}
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

function sanitizePercentInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  if (rest.length === 0) {
    return whole;
  }
  return `${whole}.${rest.join("").slice(0, 2)}`;
}

function isValidAssumptionPercent(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric > 0 && numeric <= 100;
}

function getAssumptionStatus(item: ShopItemRead) {
  return item.assumption_status ?? (
    item.base_unit === BaseUnit.KG
      ? item.assumption_percent
        ? ItemAssumptionStatus.Configured
        : ItemAssumptionStatus.NotSet
      : ItemAssumptionStatus.NotApplicable
  );
}

function assumptionStatusLabel(status: ItemAssumptionStatus) {
  if (status === ItemAssumptionStatus.Configured) return "Configured";
  if (status === ItemAssumptionStatus.Incomplete) return "Incomplete";
  if (status === ItemAssumptionStatus.NotSet) return "Not set";
  return "Not applicable";
}

function getDraftValue<TValue>(
  draft: AssumptionDraft | undefined,
  key: keyof AssumptionDraft,
  fallback: TValue,
) {
  return draft && Object.prototype.hasOwnProperty.call(draft, key)
    ? (draft[key] as TValue)
    : fallback;
}

function AssumptionRow({
  item,
  draft,
  saving,
  palette,
  onChangeDraft,
  onSaveRow,
  onClearRow,
}: {
  item: ShopItemRead;
  draft?: AssumptionDraft;
  saving: boolean;
  palette: ThemePalette;
  onChangeDraft: (item: ShopItemRead, patch: AssumptionDraft) => void;
  onSaveRow: (item: ShopItemRead, payload: ItemAssumptionUpdate) => void;
  onClearRow: (item: ShopItemRead) => void;
}) {
  const imageUri = getItemThumbnailUri(item);
  const status = getAssumptionStatus(item);
  const editable = item.base_unit === BaseUnit.KG;
  const percent = getDraftValue(draft, "assumption_percent", item.assumption_percent ?? "") ?? "";
  const valid = editable && isValidAssumptionPercent(percent);
  const dirty = Boolean(draft);
  const canClear = editable && Boolean(
    item.assumption_percent || item.assumption_inventory_item_id || item.assumption_inventory_category_id || dirty,
  );
  const statusColors = status === ItemAssumptionStatus.Configured
    ? { fg: palette.success, bg: palette.successSoft }
    : status === ItemAssumptionStatus.Incomplete
      ? { fg: palette.gold, bg: palette.goldSoft }
      : status === ItemAssumptionStatus.NotSet
        ? { fg: palette.textMuted, bg: palette.surfaceMuted }
        : { fg: palette.textMuted, bg: palette.surfaceMuted };

  return (
    <View style={[styles.assumptionRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
      <View style={styles.assumptionMain}>
        <ItemThumbnail
          uri={imageUri}
          recyclingKey={item.id}
          size={54}
          borderRadius={13}
          backgroundColor={palette.surfaceMuted}
          iconColor={palette.textMuted}
          iconSize={23}
        />
        <View style={styles.assumptionText}>
          <View style={styles.assumptionTitleLine}>
            <Text numberOfLines={1} style={[styles.itemName, { color: palette.textPrimary }]}>
              {item.name}
            </Text>
            <View style={[styles.assumptionPill, { backgroundColor: statusColors.bg }]}>
              <Text style={[styles.assumptionPillText, { color: statusColors.fg }]}>
                {assumptionStatusLabel(status)}
              </Text>
            </View>
          </View>
          <Text numberOfLines={1} style={[styles.itemTamilName, { color: palette.textSecondary }]}>
            {item.tamil_name ?? "Tamil missing"}
          </Text>
          <Text numberOfLines={1} style={[styles.itemMeta, { color: palette.textMuted }]}>
            {item.base_unit.toUpperCase()} · {item.category?.trim() || "Uncategorized"}
          </Text>
        </View>
      </View>

      <View style={styles.assumptionControls}>
        <View style={styles.assumptionInputRow}>
          <Input
            value={percent}
            onChangeText={(value) => onChangeDraft(item, { assumption_percent: sanitizePercentInput(value) })}
            disabled={!editable || saving}
            placeholder=""
            placeholderTextColor={palette.textMuted as never}
            keyboardType="decimal-pad"
            minHeight={42}
            flex={1}
            borderRadius={10}
            borderWidth={1}
            borderColor={!percent || isValidAssumptionPercent(percent) ? palette.border : palette.danger}
            backgroundColor={editable ? palette.surfaceMuted : palette.background}
            color={palette.textPrimary}
            fontSize={15}
            fontWeight="900"
            textAlign="right"
          />
          <Text style={[styles.assumptionPercentMark, { color: palette.textMuted }]}>%</Text>
        </View>

        <View style={styles.assumptionActionRow}>
          <ActionButton
            label="Clear"
            icon="close-circle-outline"
            palette={palette}
            tone="warning"
            compact
            disabled={!canClear || saving}
            onPress={() => onClearRow(item)}
          />
          <ActionButton
            label={saving ? "Saving..." : "Save"}
            icon="content-save-outline"
            palette={palette}
            tone="primary"
            compact
            disabled={!dirty || !valid || saving}
            loading={saving}
            onPress={() => onSaveRow(item, {
              assumption_percent: percent.trim(),
            })}
          />
        </View>
      </View>
    </View>
  );
}

export function AssumptionGrid({
  items,
  loading,
  refreshing,
  drafts,
  savingItemId,
  error,
  palette,
  bottomPadding,
  onRefresh,
  onChangeDraft,
  onSaveRow,
  onClearRow,
}: {
  items: ShopItemRead[];
  loading: boolean;
  refreshing: boolean;
  drafts: Record<UUID, AssumptionDraft>;
  savingItemId: UUID | null;
  error: string | null;
  palette: ThemePalette;
  bottomPadding: number;
  onRefresh: () => void;
  onChangeDraft: (item: ShopItemRead, patch: AssumptionDraft) => void;
  onSaveRow: (item: ShopItemRead, payload: ItemAssumptionUpdate) => void;
  onClearRow: (item: ShopItemRead) => void;
}) {
  const summary = useMemo(() => {
    const configured = items.filter((item) => getAssumptionStatus(item) === ItemAssumptionStatus.Configured).length;
    const incomplete = items.filter((item) => getAssumptionStatus(item) === ItemAssumptionStatus.Incomplete).length;
    return `${items.length} catalogue items · ${configured} configured${incomplete ? ` · ${incomplete} incomplete` : ""}`;
  }, [items]);

  const renderAssumptionRow = useCallback(({ item }: { item: ShopItemRead }) => (
    <AssumptionRow
      item={item}
      draft={drafts[item.id]}
      saving={savingItemId === item.id}
      palette={palette}
      onChangeDraft={onChangeDraft}
      onSaveRow={onSaveRow}
      onClearRow={onClearRow}
    />
  ), [drafts, onChangeDraft, onClearRow, onSaveRow, palette, savingItemId]);

  return (
    <FlatList
      data={loading ? [] : items}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={10}
      maxToRenderPerBatch={8}
      updateCellsBatchingPeriod={40}
      windowSize={7}
      removeClippedSubviews
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.items} />}
      ListHeaderComponent={
        <YStack gap={12} marginBottom={4}>
          <ErrorState message={error} palette={palette} onRetry={onRefresh} />
          <View style={[styles.priceSummary, { borderColor: palette.border, backgroundColor: palette.card }]}>
            <XStack alignItems="center" justifyContent="space-between" gap={10}>
              <YStack flex={1} minWidth={0}>
                <Text numberOfLines={1} style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                  Assumption
                </Text>
                <Text numberOfLines={1} style={[styles.sectionSubtitle, { color: palette.textMuted }]}>
                  {summary}
                </Text>
              </YStack>
            </XStack>
          </View>
        </YStack>
      }
      renderItem={renderAssumptionRow}
      ListEmptyComponent={
        loading ? (
          <YStack gap={8}>
            <LoadingRow palette={palette} />
            <LoadingRow palette={palette} />
            <LoadingRow palette={palette} />
          </YStack>
        ) : (
          <EmptyState
            title="No catalogue items"
            message="Create catalogue items before setting assumptions."
            icon="percent"
            palette={palette}
          />
        )
      }
    />
  );
}

const PriceRow = memo(function PriceRow({
  item,
  value,
  dirty,
  valid,
  saving,
  palette,
  thumbnailSize = 60,
  onChangeDraftPrice,
  onSaveRow,
}: {
  item: ItemPriceRead;
  value: string;
  dirty: boolean;
  valid: boolean;
  saving: boolean;
  palette: ThemePalette;
  thumbnailSize?: number;
  onChangeDraftPrice: (itemId: UUID, value: string) => void;
  onSaveRow: (item: ItemPriceRead, value: string) => void;
}) {
  const imageUri = getItemThumbnailUri(item);
  const thumbnailRadius = Math.round(thumbnailSize * 0.24);
  const thumbnailIconSize = Math.round(thumbnailSize * 0.43);
  const updatedToday = item.price_status === PriceStatus.Current;
  return (
    <View style={[styles.priceRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
      <ItemThumbnail
        uri={imageUri}
        recyclingKey={item.item_id}
        size={thumbnailSize}
        borderRadius={thumbnailRadius}
        backgroundColor={palette.surfaceMuted}
        iconColor={palette.textMuted}
        iconSize={thumbnailIconSize}
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
        <View
          style={[
            styles.priceStatusPill,
            {
              backgroundColor: updatedToday ? palette.inventorySoft : palette.dangerSoft,
            },
          ]}
        >
          <View
            style={[
              styles.priceStatusDot,
              { backgroundColor: updatedToday ? palette.inventoryStrong : palette.danger },
            ]}
          />
          <Text
            style={[
              styles.priceStatusText,
              { color: updatedToday ? palette.inventoryStrong : palette.danger },
            ]}
          >
            {updatedToday ? "Updated today" : "Needs update"}
          </Text>
        </View>
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
  previous.thumbnailSize === next.thumbnailSize &&
  previous.palette === next.palette
));

const PriceHistoryRow = memo(function PriceHistoryRow({
  item,
  palette,
  thumbnailSize = 60,
}: {
  item: ItemPriceRead;
  palette: ThemePalette;
  thumbnailSize?: number;
}) {
  const imageUri = getItemThumbnailUri(item);
  const thumbnailRadius = Math.round(thumbnailSize * 0.24);
  const thumbnailIconSize = Math.round(thumbnailSize * 0.43);
  const hasPrice = Boolean(item.current_price);

  return (
    <View style={[styles.priceHistoryRow, { borderColor: palette.border, backgroundColor: palette.card }]}>
      <ItemThumbnail
        uri={imageUri}
        recyclingKey={item.item_id}
        size={thumbnailSize}
        borderRadius={thumbnailRadius}
        backgroundColor={palette.surfaceMuted}
        iconColor={palette.textMuted}
        iconSize={thumbnailIconSize}
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
      <View
        style={[
          styles.priceHistoryValue,
          {
            borderColor: hasPrice ? palette.success : palette.border,
            backgroundColor: hasPrice ? palette.successSoft : palette.surfaceMuted,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.priceHistoryValueText, { color: hasPrice ? palette.success : palette.textMuted }]}
        >
          {item.current_price ? `Rs. ${toMoneyString(item.current_price)}` : "No price"}
        </Text>
      </View>
    </View>
  );
}, (previous, next) => (
  previous.item.item_id === next.item.item_id &&
  previous.item.item_name === next.item.item_name &&
  previous.item.item_tamil_name === next.item.item_tamil_name &&
  previous.item.base_unit === next.item.base_unit &&
  previous.item.current_price === next.item.current_price &&
  previous.item.image_path === next.item.image_path &&
  previous.item.image_thumb_path === next.item.image_thumb_path &&
  previous.thumbnailSize === next.thumbnailSize &&
  previous.palette === next.palette
));

function PriceHistoryCalendar({
  selectedDate,
  visibleMonth,
  loading,
  palette,
  onChangeMonth,
  onSelectDate,
  onRefresh,
}: {
  selectedDate: string;
  visibleMonth: string;
  loading: boolean;
  palette: ThemePalette;
  onChangeMonth: (month: string) => void;
  onSelectDate: (dateValue: string) => void;
  onRefresh: () => void;
}) {
  const days = useMemo(() => buildHistoryCalendarDays(visibleMonth), [visibleMonth]);
  const visibleMonthDate = parseDateInputValue(visibleMonth);
  const todayValue = toDateInputValue(new Date());

  return (
    <View style={[styles.priceHistoryPanel, { borderColor: palette.border, backgroundColor: palette.surfaceMuted }]}>
      <XStack alignItems="center" justifyContent="space-between" gap={8}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onChangeMonth(shiftMonthValue(visibleMonth, -1))}
          style={[styles.historyIconButton, { borderColor: palette.border, backgroundColor: palette.card }]}
        >
          <MaterialCommunityIcons name="chevron-left" size={20} color={palette.textPrimary} />
        </Pressable>
        <YStack flex={1} minWidth={0} alignItems="center">
          <Text numberOfLines={1} style={[styles.historyMonthTitle, { color: palette.textPrimary }]}>
            {priceHistoryMonthFormatter.format(visibleMonthDate)}
          </Text>
          <Text numberOfLines={1} style={[styles.historySelectedDate, { color: palette.textMuted }]}>
            {formatHistoryDate(selectedDate)}
          </Text>
        </YStack>
        <Pressable
          accessibilityRole="button"
          onPress={() => onChangeMonth(shiftMonthValue(visibleMonth, 1))}
          style={[styles.historyIconButton, { borderColor: palette.border, backgroundColor: palette.card }]}
        >
          <MaterialCommunityIcons name="chevron-right" size={20} color={palette.textPrimary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={onRefresh}
          style={[
            styles.historyIconButton,
            { borderColor: palette.items, backgroundColor: palette.itemsSoft, opacity: loading ? 0.62 : 1 },
          ]}
        >
          {loading ? (
            <Spinner color={palette.itemsStrong} size="small" />
          ) : (
            <MaterialCommunityIcons name="refresh" size={18} color={palette.itemsStrong} />
          )}
        </Pressable>
      </XStack>
      <View style={styles.historyWeekdayRow}>
        {PRICE_HISTORY_WEEKDAYS.map((weekday, index) => (
          <Text key={`${weekday}-${index}`} style={[styles.historyWeekdayText, { color: palette.textMuted }]}>
            {weekday}
          </Text>
        ))}
      </View>
      <View style={styles.historyDayGrid}>
        {days.map((dateValue, index) => {
          if (!dateValue) {
            return <View key={`empty-${index}`} style={styles.historyDayCell} />;
          }
          const selected = dateValue === selectedDate;
          const isToday = dateValue === todayValue;
          const dayNumber = parseDateInputValue(dateValue).getDate();
          return (
            <Pressable
              key={dateValue}
              accessibilityRole="button"
              onPress={() => onSelectDate(dateValue)}
              style={[
                styles.historyDayCell,
                styles.historyDayButton,
                {
                  borderColor: selected ? palette.items : isToday ? palette.success : palette.border,
                  backgroundColor: selected ? palette.items : isToday ? palette.successSoft : palette.card,
                },
              ]}
            >
              <Text style={[styles.historyDayText, { color: selected ? palette.onPrimary : palette.textPrimary }]}>
                {dayNumber}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function PriceGrid({
  items,
  loading,
  refreshing,
  draftPrices,
  savingAll,
  savingItemId,
  error,
  selectedShop,
  historyOpen,
  historyDate,
  historyMonth,
  historyItems,
  historyLoading,
  historyError,
  palette,
  bottomPadding,
  onRefresh,
  onBackToItems,
  onToggleHistory,
  onChangeHistoryMonth,
  onSelectHistoryDate,
  onRefreshHistory,
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
  historyOpen: boolean;
  historyDate: string;
  historyMonth: string;
  historyItems: ItemPriceRead[];
  historyLoading: boolean;
  historyError: string | null;
  palette: ThemePalette;
  bottomPadding: number;
  onRefresh: () => void;
  onBackToItems: () => void;
  onToggleHistory: () => void;
  onChangeHistoryMonth: (month: string) => void;
  onSelectHistoryDate: (dateValue: string) => void;
  onRefreshHistory: () => void;
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
    if (priceState.completeEntries.length !== items.length) {
      return;
    }
    onCompleteToday(priceState.completeEntries, 0);
  }, [
    items.length,
    onCompleteToday,
    priceState.completeEntries,
    priceState.incompleteCount,
  ]);
  const priceSummaryText = `${selectedShop?.name ?? "Select a shop"} · ${items.length} items · ${priceState.dirtyCount} unsaved${
    priceState.incompleteCount > 0 ? ` · ${priceState.incompleteCount} need price` : ""
  }`;
  const historySummaryText = `${selectedShop?.name ?? "Select a shop"} · ${formatHistoryDate(historyDate)} · ${
    historyItems.length
  } items`;

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
  const renderHistoryRow = useCallback(({ item }: { item: ItemPriceRead }) => (
    <PriceHistoryRow item={item} palette={palette} />
  ), [palette]);
  const priceListExtraData = useMemo(
    () => ({
      draftPrices,
      historyDate,
      historyOpen,
      historyLoading,
      historyItems,
      savingItemId,
    }),
    [draftPrices, historyDate, historyItems, historyLoading, historyOpen, savingItemId],
  );
  const listItems = historyOpen ? historyItems : items;
  const listLoading = historyOpen ? historyLoading : loading;
  const activeError = historyOpen ? historyError : error;

  return (
    <FlatList
      data={listLoading ? [] : listItems}
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
      contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.items} />}
      ListHeaderComponent={
        <YStack gap={12} marginBottom={4}>
          <ErrorState message={activeError} palette={palette} onRetry={historyOpen ? onRefreshHistory : onRefresh} />
          <View style={[styles.priceSummary, { borderColor: palette.border, backgroundColor: palette.card }]}>
            <XStack alignItems="center" justifyContent="space-between" gap={10}>
              <YStack flex={1} minWidth={0}>
                <Text numberOfLines={1} style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                  {historyOpen ? "Price history" : "Daily prices"}
                </Text>
                <Text numberOfLines={1} style={[styles.sectionSubtitle, { color: palette.textMuted }]}>
                  {historyOpen ? historySummaryText : priceSummaryText}
                </Text>
              </YStack>
              <XStack gap={8}>
                <ActionButton
                  label="Items"
                  icon="arrow-left"
                  palette={palette}
                  tone="neutral"
                  onPress={onBackToItems}
                  compact
                />
                <ActionButton
                  label={historyOpen ? "Today" : "History"}
                  icon={historyOpen ? "calendar-today" : "history"}
                  palette={palette}
                  tone="info"
                  active={historyOpen}
                  onPress={onToggleHistory}
                  compact
                />
              </XStack>
            </XStack>
            {historyOpen ? (
              <PriceHistoryCalendar
                selectedDate={historyDate}
                visibleMonth={historyMonth}
                loading={historyLoading}
                palette={palette}
                onChangeMonth={onChangeHistoryMonth}
                onSelectDate={onSelectHistoryDate}
                onRefresh={onRefreshHistory}
              />
            ) : (
              <XStack gap={8} flexWrap="wrap">
                <ActionButton
                  label={savingAll ? "Saving..." : "Save edited prices"}
                  icon="content-save-all-outline"
                  palette={palette}
                  tone="primary"
                  loading={savingAll}
                  disabled={priceState.dirtyCount === 0 || priceState.invalidDirtyCount > 0}
                  onPress={() => onSaveEdited(priceState.dirtyEntries)}
                />
                <ActionButton 
                  label={savingAll ? "Publishing..." : "Save"}
                  icon="calendar-check-outline"
                  palette={palette}
                  tone="success"
                  loading={savingAll}
                  disabled={
                    items.length === 0
                    || priceState.incompleteCount > 0
                    || priceState.completeEntries.length !== items.length
                    || savingAll
                  }
                  onPress={completeToday}
                />
              </XStack>
            )}
          </View>
        </YStack>
      }
      renderItem={historyOpen ? renderHistoryRow : renderPriceRow}
      ListEmptyComponent={
        listLoading ? (
          <YStack gap={8}>
            <LoadingRow palette={palette} />
            <LoadingRow palette={palette} />
            <LoadingRow palette={palette} />
          </YStack>
        ) : (
          <EmptyState
            title={historyOpen ? "No prices found" : "No allocated items"}
            message={
              historyOpen
                ? "No item prices were saved on the selected day."
                : "Allocate items to this shop before setting daily prices."
            }
            icon={historyOpen ? "calendar-remove-outline" : "link-variant-off"}
            action={
              historyOpen
                ? { label: "Refresh", icon: "refresh", onPress: onRefreshHistory }
                : { label: "Back to items", icon: "arrow-left", onPress: onBackToItems }
            }
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
    gap: 12,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
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
    minHeight: 40,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 12,
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
    gap: 12,
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
    alignItems: "center",
    padding: 12,
  },
  centeredModalOverlay: {
    justifyContent: "center",
  },
  shopSheet: {
    width: "100%",
    maxWidth: 520,
    borderRadius: adminRadii.card,
    padding: adminSpacing.sm + 2,
    gap: adminSpacing.sm,
    ...adminElevation(3),
  },
  categorySheet: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "82%",
    borderRadius: adminRadii.card,
    padding: adminSpacing.sm + 2,
    gap: adminSpacing.sm,
    ...adminElevation(3),
  },
  actionSheet: {
    width: "100%",
    maxWidth: 520,
    borderRadius: adminRadii.card,
    padding: adminSpacing.sm + 2,
    gap: adminSpacing.sm,
    maxHeight: "82%",
    ...adminElevation(3),
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
    gap: 12,
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
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  shopOptionText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  importSelectionBar: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  importSelectionText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "900",
  },
  categoryFilterButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  categoryFilterText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  categoryFilterLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
  },
  categoryMenuScroll: {
    flexGrow: 0,
    maxHeight: 360,
  },
  categoryMenuContent: {
    gap: 7,
  },
  categoryMenuOption: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  categoryMenuText: {
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
    paddingHorizontal: 12,
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
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
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
    padding: 12,
    gap: 12,
  },
  itemRowWithSideActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  itemMain: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  itemMainWithSideActions: {
    flex: 1,
    alignItems: "center",
  },
  itemText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  rowActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "stretch",
  },
  rowActionsSide: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
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
  itemStatusRow: {
    marginTop: 6,
    alignSelf: "flex-start",
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
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  priceText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  priceStatusPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  priceStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  priceStatusText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0,
  },
  priceEdit: {
    width: 116,
    gap: 6,
  },
  priceHistoryRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  priceHistoryValue: {
    width: 104,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  priceHistoryValueText: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "900",
  },
  priceHistoryPanel: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  historyIconButton: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  historyMonthTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
  },
  historySelectedDate: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
  },
  historyWeekdayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  historyWeekdayText: {
    width: "13%",
    textAlign: "center",
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "900",
  },
  historyDayGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 6,
  },
  historyDayCell: {
    width: "13%",
    height: 34,
  },
  historyDayButton: {
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  historyDayText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
  assumptionRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  assumptionMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  assumptionText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  assumptionTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  assumptionPill: {
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  assumptionPillText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  assumptionControls: {
    gap: 8,
  },
  assumptionInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  assumptionPercentMark: {
    width: 22,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "900",
  },
  assumptionActionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
});
