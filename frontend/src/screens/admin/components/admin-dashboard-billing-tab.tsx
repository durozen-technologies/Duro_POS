import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { UUID } from "@/types/api";

import { adminShadow, type ThemePalette } from "../admin-dashboard-theme";
import type { BillingSection } from "../hooks/use-admin-dashboard-view-model";
import {
  DashboardErrorBanner,
  EmptyStateCard,
  SectionHint,
  TabSectionHeader,
} from "./admin-dashboard-primitives";

type AdminBillingTabProps = {
  dashboardError: string | null;
  hasShops: boolean;
  palette: ThemePalette;
  billingSections: BillingSection[];
  visibleBillCount: number;
  visibleBillsLength: number;
  dailyBillsLength: number;
  dailyBillsHasMore: boolean;
  dailyBillsLoadingMore: boolean;
  refreshing: boolean;
  bottomSpacer: number;
  printingAll: boolean;
  onRefresh: () => void;
  onOpenBill: (billId: UUID) => void;
  onPrintAll: () => void;
  onLoadMore: () => void;
};

export const AdminBillingTab = memo(function AdminBillingTab({
  dashboardError,
  hasShops,
  palette,
  billingSections,
  visibleBillCount,
  visibleBillsLength,
  dailyBillsLength,
  dailyBillsHasMore,
  dailyBillsLoadingMore,
  refreshing,
  bottomSpacer,
  printingAll,
  onRefresh,
  onOpenBill,
  onPrintAll,
  onLoadMore,
}: AdminBillingTabProps) {
  return (
    <SectionList<BillingSection["data"][number], BillingSection>
      sections={billingSections}
      keyExtractor={(item) => `${item.bill_id}`}
      renderSectionHeader={({ section }) => (
        <Text style={[styles.billGroupTitle, { color: palette.textMuted }]}>{section.title}</Text>
      )}
      renderItem={({ item: bill }) => (
        <Pressable
          onPress={() => onOpenBill(bill.bill_id)}
          style={({ pressed }) => [
            styles.billCard,
            adminShadow(palette.shadow, 0.06, 3, 10),
            {
              backgroundColor: palette.card,
              borderColor: palette.border,
              opacity: pressed ? 0.82 : 1,
              transform: [{ scale: pressed ? 0.985 : 1 }],
            },
          ]}
        >
          <View style={[styles.billCardAccent, { backgroundColor: palette.emerald }]} />

          <View style={styles.billCardBody}>
            <View style={styles.billCardTopRow}>
              <Text style={[styles.billCardNo, { color: palette.textPrimary }]} numberOfLines={1}>
                {bill.bill_no}
              </Text>
              <Text style={[styles.billCardAmount, { color: palette.emerald }]}>
                {bill.formattedAmount}
              </Text>
            </View>
            <View style={styles.billCardBottomRow}>
              <MaterialCommunityIcons name="clock-outline" size={12} color={palette.textMuted} />
              <Text style={[styles.billCardDate, { color: palette.textMuted }]}>
                {bill.formattedDateTime}
              </Text>
              <View style={styles.spacer} />
              <MaterialCommunityIcons name="chevron-right" size={16} color={palette.textMuted} />
            </View>
          </View>
        </Pressable>
      )}
      ListHeaderComponent={
        <View style={styles.billingListHeader}>
          <DashboardErrorBanner dashboardError={dashboardError} hasShops={hasShops} palette={palette} />
          <TabSectionHeader title="Billing Feed" badgeLabel={`${visibleBillCount} bills`} palette={palette} />
          {visibleBillsLength > 0 ? (
            <Pressable
              onPress={onPrintAll}
              style={[
                styles.printAllBtn,
                adminShadow(palette.shadow, 0.04, 4, 8),
                {
                  backgroundColor: printingAll ? palette.surfaceMuted : palette.emeraldSoft,
                  borderColor: palette.emerald,
                },
              ]}
            >
              <MaterialCommunityIcons name="printer-outline" size={16} color={palette.emerald} />
              <Text style={[styles.printAllBtnText, { color: palette.emeraldDark }]}>
                {printingAll ? "Opening printer..." : `Print All (${visibleBillsLength})`}
              </Text>
            </Pressable>
          ) : null}
          {visibleBillsLength > 0 ? (
            <SectionHint text="Tap any bill to open the preview and print the receipt." palette={palette} />
          ) : null}
          {dailyBillsHasMore ? (
            <SectionHint
              text={`Showing the latest ${dailyBillsLength} bills in this range. Scroll to load older entries.`}
              palette={palette}
            />
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <EmptyStateCard
          title="No bills found"
          subtitle="No bills are available for this branch and date range yet."
          actionLabel="Refresh"
          onAction={onRefresh}
          icon="receipt-text-remove-outline"
          palette={palette}
        />
      }
      ListFooterComponent={
        dailyBillsLoadingMore ? (
          <View style={styles.billingListFooter}>
            <ActivityIndicator color={palette.emerald} />
            <SectionHint text="Loading older bills..." palette={palette} />
          </View>
        ) : dailyBillsHasMore ? (
          <View style={styles.billingListFooter}>
            <SectionHint text="Scroll to load older bills." palette={palette} />
          </View>
        ) : dailyBillsLength > 0 ? (
          <View style={styles.billingListFooter}>
            <SectionHint text="Reached the end of this billing feed." palette={palette} />
          </View>
        ) : null
      }
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: bottomSpacer }}
      keyboardShouldPersistTaps="handled"
      onEndReached={onLoadMore}
      onEndReachedThreshold={0.35}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={palette.emerald}
          colors={[palette.emerald]}
        />
      }
      showsVerticalScrollIndicator={false}
      stickySectionHeadersEnabled={false}
    />
  );
});

const styles = StyleSheet.create({
  spacer: {
    flex: 1,
  },
  billingListHeader: {
    gap: 12,
    marginBottom: 8,
  },
  billingListFooter: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
  },
  printAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  printAllBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  billGroupTitle: {
    marginTop: 6,
    marginBottom: 8,
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  billCard: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 10,
    overflow: "hidden",
  },
  billCardAccent: {
    width: 4,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },
  billCardBody: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  billCardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  billCardNo: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.2,
    flex: 1,
  },
  billCardAmount: {
    fontSize: 15,
    fontWeight: "800",
  },
  billCardBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  billCardDate: {
    fontSize: 11,
    fontWeight: "400",
  },
});
