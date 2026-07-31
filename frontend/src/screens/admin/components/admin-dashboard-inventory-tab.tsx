import { memo } from "react";
import { FlatList, Platform, RefreshControl, StyleSheet, View } from "react-native";

import type { ItemSalesSummary } from "@/types/api";
import { useAdminTranslation } from "@/hooks/use-admin-translation";

import type { ThemePalette } from "../admin-dashboard-theme";
import { InventoryItemCard } from "./admin-dashboard-tab-cards";
import {
  DashboardErrorBanner,
  EmptyStateCard,
  PrimaryButton,
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
  onOpenBilling: () => void;
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
  onOpenBilling,
}: AdminInventoryTabProps) {
  const { t } = useAdminTranslation();

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
          <TabSectionHeader
            title={t("inventory.itemsSold")}
            badgeLabel={t("inventory.itemCount", { count: filteredItemSales.length })}
            badgeBackgroundColor={palette.analyticsSoft}
            badgeTextColor={palette.analyticsStrong}
            palette={palette}
          />
          <PrimaryButton
            label={t("inventory.showBill")}
            icon="receipt-text-outline"
            variant="success"
            fullWidth
            palette={palette}
            onPress={onOpenBilling}
            accessibilityLabel={t("inventory.showBill")}
          />
          <SearchField
            value={itemSearch}
            onChangeText={onChangeSearch}
            placeholder={t("inventory.searchItems")}
            accessibilityLabel={t("inventory.searchSoldItems")}
            palette={palette}
          />
        </View>
      }
      ListEmptyComponent={
        <EmptyStateCard
          title={itemSearch.trim() ? t("common.noResults") : t("inventory.noItemsSold")}
          subtitle={itemSearch.trim() ? t("empty.tryDifferentSearch") : t("inventory.noSalesForPeriod")}
          actionLabel={itemSearch.trim() ? t("common.clearSearch") : undefined}
          onAction={itemSearch.trim() ? () => onChangeSearch("") : undefined}
          icon="cart-off"
          palette={palette}
        />
      }
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: bottomPadding, gap: 12 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={palette.analytics}
          colors={[palette.analytics]}
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
    gap: 16,
    marginBottom: 12,
  },
});
