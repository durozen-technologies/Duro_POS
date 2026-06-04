import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo } from "react";
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import type { ShopRead, UUID } from "@/types/api";

import { adminShadow, type ThemePalette } from "../admin-dashboard-theme";
import type { ShopDashboardRow } from "../hooks/use-admin-dashboard-data";
import { AdminLogoutCard, BranchControlCard } from "./admin-dashboard-tab-cards";
import {
  DashboardErrorBanner,
  EmptyStateCard,
  SectionHint,
  TabSectionHeader,
} from "./admin-dashboard-primitives";

type AdminSettingsTabProps = {
  dashboardError: string | null;
  hasShops: boolean;
  palette: ThemePalette;
  visibleShopRows: ShopDashboardRow[];
  branchRanking: Map<UUID, number>;
  statusUpdatingShopId: UUID | null;
  refreshing: boolean;
  bottomPadding: number;
  onRefresh: () => void;
  onCreateBranch: () => void;
  onManageBranch: (shop: ShopRead) => void;
  onToggleBranch: (shopId: UUID, isActive: boolean) => void;
  onLogout: () => void;
};

export const AdminSettingsTab = memo(function AdminSettingsTab({
  dashboardError,
  hasShops,
  palette,
  visibleShopRows,
  branchRanking,
  statusUpdatingShopId,
  refreshing,
  bottomPadding,
  onRefresh,
  onCreateBranch,
  onManageBranch,
  onToggleBranch,
  onLogout,
}: AdminSettingsTabProps) {
  const listHeader = (
    <View style={styles.header}>
      <DashboardErrorBanner dashboardError={dashboardError} hasShops={hasShops} palette={palette} />
      <TabSectionHeader title="Branch Access & Settings" palette={palette} />
      <SectionHint
        text="Open a branch to update access or delete a shop that has no billing or price history."
        palette={palette}
      />
      <Pressable
        onPress={onCreateBranch}
        style={[
          styles.createShopBtn,
          adminShadow(palette.shadow, 0.06, 8, 14),
          { backgroundColor: palette.settings },
        ]}
      >
        <MaterialCommunityIcons name="store-plus-outline" size={20} color={palette.background} />
        <Text style={[styles.createShopBtnText, { color: palette.background }]}>+ Create New Branch</Text>
      </Pressable>
    </View>
  );

  return (
    <FlatList
      data={visibleShopRows}
      keyExtractor={(item) => `${item.shop.id}`}
      renderItem={({ item, index }) => (
        <BranchControlCard
          row={item}
          rank={branchRanking.get(item.shop.id) ?? index + 1}
          palette={palette}
          statusUpdating={statusUpdatingShopId === item.shop.id}
          onManage={onManageBranch}
          onToggle={onToggleBranch}
        />
      )}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={
        <EmptyStateCard
          title="No branches available"
          subtitle="Create a branch to start tracking sales."
          actionLabel="Create Branch"
          onAction={onCreateBranch}
          icon="store-off-outline"
          palette={palette}
        />
      }
      ListFooterComponent={<AdminLogoutCard palette={palette} onLogout={onLogout} />}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: bottomPadding, gap: 10 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={palette.settings}
          colors={[palette.settings]}
        />
      }
      removeClippedSubviews={Platform.OS === "android"}
      initialNumToRender={6}
      maxToRenderPerBatch={4}
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
  createShopBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  createShopBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
});
