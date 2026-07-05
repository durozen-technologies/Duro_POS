import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo } from "react";
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import type { OrganizationBranchQuota, ShopRead, UUID } from "@/types/api";

import { type ThemePalette } from "../admin-dashboard-theme";
import type { ShopDashboardRow } from "../hooks/use-admin-dashboard-data";
import { AdminLogoutCard, BranchControlCard } from "./admin-dashboard-tab-cards";
import { ShopBackdatingPolicySection } from "./shop-backdating-policy-section";
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
  branchQuota: OrganizationBranchQuota;
  statusUpdatingShopId: UUID | null;
  refreshing: boolean;
  bottomPadding: number;
  onRefresh: () => void;
  onCreateBranch: () => void;
  onOpenReports: () => void;
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
  branchQuota,
  statusUpdatingShopId,
  refreshing,
  bottomPadding,
  onRefresh,
  onCreateBranch,
  onOpenReports,
  onManageBranch,
  onToggleBranch,
  onLogout,
}: AdminSettingsTabProps) {
  const listHeader = (
    <View style={styles.header}>
      <DashboardErrorBanner dashboardError={dashboardError} hasShops={hasShops} palette={palette} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <TabSectionHeader title="Branch Access & Settings" palette={palette} />
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onLogout}
          style={({ pressed }) => [
            {
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              width: 72,
              height: 72,
              borderRadius: 12,
              backgroundColor: palette.dangerSoft,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <MaterialCommunityIcons name="logout" size={24} color={palette.danger} />
          <Text style={{ color: palette.danger, fontSize: 13, fontWeight: "600" }}>Logout</Text>
        </Pressable>
      </View>
      <SectionHint
        text="Open a branch to update access or delete a shop that has no billing or price history."
        palette={palette}
      />
      <Text style={[styles.quotaText, { color: palette.textMuted }]}>
        Branch quota: {branchQuota.branch_count}/{branchQuota.max_branches} used ·{" "}
        {branchQuota.remaining_branches} remaining
      </Text>
      {!branchQuota.can_create_branch ? (
        <View
          style={[
            styles.quotaBanner,
            { backgroundColor: palette.warningSoft, borderColor: palette.warning },
          ]}
        >
          <Text style={[styles.quotaBannerText, { color: palette.warning }]}>
            Branch limit reached. Contact Durozen Technologies to request additional capacity.
          </Text>
        </View>
      ) : null}
      <Pressable
        onPress={onCreateBranch}
        disabled={!branchQuota.can_create_branch}
        style={[
          styles.createShopBtn,
          {
            backgroundColor: palette.primary,
            opacity: branchQuota.can_create_branch ? 1 : 0.45,
          },
        ]}
      >
        <MaterialCommunityIcons name="store-plus-outline" size={20} color={palette.background} />
        <Text style={[styles.createShopBtnText, { color: palette.background }]}>+ Create New Branch</Text>
      </Pressable>
      <Pressable
        onPress={onOpenReports}
        style={[
          styles.reportBtn,
          { backgroundColor: palette.card, borderColor: palette.border },
        ]}
      >
        <MaterialCommunityIcons name="file-chart-outline" size={20} color={palette.primary} />
        <Text style={[styles.reportBtnText, { color: palette.textPrimary }]}>Generate Reports</Text>
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
      ListFooterComponent={
        <View style={{ gap: 12 }}>
          <ShopBackdatingPolicySection palette={palette} />
        </View>
      }
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: bottomPadding, gap: 12 }}
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
    marginBottom: 12,
  },
  createShopBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  createShopBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
  quotaText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  quotaBanner: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  quotaBannerText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  reportBtn: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  reportBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
});
