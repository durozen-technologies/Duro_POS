import { memo } from "react";
import { FlatList, Platform, RefreshControl, StyleSheet, View } from "react-native";

import type { ItemSalesSummary } from "@/types/api";

import type { ThemePalette } from "../admin-dashboard-theme";
import { InventoryItemCard } from "./admin-dashboard-tab-cards";
import {
  DashboardErrorBanner,
  EmptyStateCard,
  SearchField,
  TabSectionHeader,
} from "./admin-dashboard-primitives";

type AdminInventoryTabProps = {
  dashboardError: string | null;
  hasShops: boolean;
  palette: ThemePalette;
  filteredItemSales: ItemSalesSummary[];
  itemRevenueAverage: number;
  itemSearch: string;
  onChangeSearch: (value: string) => void;
  refreshing: boolean;
  bottomPadding: number;
  onRefresh: () => void;
};

export const AdminInventoryTab = memo(function AdminInventoryTab({
  dashboardError,
  hasShops,
  palette,
  filteredItemSales,
  itemRevenueAverage,
  itemSearch,
  onChangeSearch,
  refreshing,
  bottomPadding,
  onRefresh,
}: AdminInventoryTabProps) {
  return (
    <FlatList
      data={filteredItemSales}
      keyExtractor={(item) => `${item.item_id}`}
      renderItem={({ item }) => (
        <InventoryItemCard item={item} itemRevenueAverage={itemRevenueAverage} palette={palette} />
      )}
      ListHeaderComponent={
        <View style={styles.header}>
          <DashboardErrorBanner dashboardError={dashboardError} hasShops={hasShops} palette={palette} />
          <TabSectionHeader title="Items Sold" badgeLabel={`${filteredItemSales.length} items`} palette={palette} />
          <SearchField
            value={itemSearch}
            onChangeText={onChangeSearch}
            placeholder="Search items"
            accessibilityLabel="Search sold items"
            palette={palette}
          />
        </View>
      }
      ListEmptyComponent={
        <EmptyStateCard
          title="No item movement found"
          subtitle="Try a different branch or search term."
          actionLabel="Clear Search"
          onAction={() => onChangeSearch("")}
          icon="food-off-outline"
          palette={palette}
        />
      }
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: bottomPadding, gap: 10 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={palette.emerald}
          colors={[palette.emerald]}
        />
      }
      removeClippedSubviews={Platform.OS === "android"}
      initialNumToRender={8}
      maxToRenderPerBatch={6}
      updateCellsBatchingPeriod={48}
      windowSize={7}
      showsVerticalScrollIndicator={false}
    />
  );
});

const styles = StyleSheet.create({
  header: {
    gap: 12,
    marginBottom: 10,
  },
});
