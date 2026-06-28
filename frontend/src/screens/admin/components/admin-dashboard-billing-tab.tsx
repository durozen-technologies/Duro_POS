import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { UUID } from "@/types/api";

import { type ThemePalette } from "../admin-dashboard-theme";
import type { BillingSection } from "../hooks/use-admin-dashboard-view-model";
import {
  DashboardErrorBanner,
  EmptyStateCard,
  TabSectionHeader,
  usePressAnimation,
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

type BillingItem = BillingSection["data"][number];

function BillingStat({
  icon,
  label,
  value,
  palette,
  tone = "billing",
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  value: string;
  palette: ThemePalette;
  tone?: "billing" | "neutral";
}) {
  const isBilling = tone === "billing";
  return (
    <View
      style={[
        styles.statChip,
        {
          backgroundColor: isBilling ? palette.billingSoft : palette.surfaceMuted,
          borderColor: isBilling ? palette.billing : palette.border,
        },
      ]}
    >
      <MaterialCommunityIcons
        name={icon}
        size={15}
        color={isBilling ? palette.billing : palette.textMuted}
      />
      <View style={styles.statTextWrap}>
        <Text style={[styles.statLabel, { color: palette.textMuted }]} numberOfLines={1}>
          {label}
        </Text>
        <Text
          style={[styles.statValue, { color: isBilling ? palette.billingStrong : palette.textPrimary }]}
          numberOfLines={1}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

function BillCard({
  bill,
  palette,
  onPress,
}: {
  bill: BillingItem;
  palette: ThemePalette;
  onPress: () => void;
}) {
  const { scale, opacity, onPressIn, onPressOut } = usePressAnimation();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open bill ${bill.bill_no}, ${bill.formattedAmount}`}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <Animated.View
        style={[
          styles.billCard,
          {
            backgroundColor: palette.card,
            borderColor: palette.border,
            opacity,
            transform: [{ scale }],
          },
        ]}
      >
      <View style={[styles.billIconWrap, { backgroundColor: palette.billingSoft }]}>
        <MaterialCommunityIcons name="receipt-text-outline" size={20} color={palette.billing} />
      </View>

      <View style={styles.billCardBody}>
        <View style={styles.billCardTopRow}>
          <View style={styles.billTitleWrap}>
            <Text style={[styles.billCardNo, { color: palette.textPrimary }]} numberOfLines={1}>
              {bill.bill_no}
            </Text>
            <View style={styles.billMetaRow}>
              <MaterialCommunityIcons name="clock-outline" size={12} color={palette.textMuted} />
              <Text style={[styles.billCardDate, { color: palette.textMuted }]} numberOfLines={1}>
                {bill.formattedDateTime}
              </Text>
            </View>
          </View>
          <View style={[styles.amountPill, { backgroundColor: palette.cashSoft, borderColor: palette.cash }]}>
            <Text
              style={[styles.billCardAmount, { color: palette.cash }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.76}
            >
              {bill.formattedAmount}
            </Text>
          </View>
        </View>

        <View style={styles.billCardBottomRow}>
          <Text style={[styles.billActionText, { color: palette.billingStrong }]}>Open receipt</Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={palette.billing} />
        </View>
      </View>
      </Animated.View>
    </Pressable>
  );
}

function PrintAllButton({
  printingAll,
  onPrintAll,
  visibleBillsLength,
  palette,
}: {
  printingAll: boolean;
  onPrintAll: () => void;
  visibleBillsLength: number;
  palette: ThemePalette;
}) {
  const { scale, opacity, onPressIn, onPressOut } = usePressAnimation(printingAll);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Print ${visibleBillsLength} visible bills`}
      accessibilityState={{ disabled: printingAll }}
      disabled={printingAll}
      onPress={onPrintAll}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <Animated.View
        style={[
          styles.printAllBtn,
          {
            backgroundColor: printingAll ? palette.surfaceMuted : palette.primarySoft,
            borderColor: palette.primary,
            opacity: printingAll ? 0.6 : opacity,
            transform: [{ scale }],
          },
        ]}
      >
        {printingAll ? (
          <ActivityIndicator size="small" color={palette.billing} />
        ) : (
          <MaterialCommunityIcons name="printer-outline" size={18} color={palette.billing} />
        )}
        <Text style={[styles.printAllBtnText, { color: palette.billingStrong }]}>
          {printingAll ? "Opening printer..." : `Print ${visibleBillsLength} receipts`}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

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
  const hasBills = visibleBillsLength > 0;

  return (
    <SectionList<BillingItem, BillingSection>
      sections={billingSections}
      keyExtractor={(item) => `${item.bill_id}`}
      renderSectionHeader={({ section }) => (
        <View style={styles.billGroupHeader}>
          <Text style={[styles.billGroupTitle, { color: palette.textMuted }]}>{section.title}</Text>
          <View style={[styles.billGroupLine, { backgroundColor: palette.border }]} />
        </View>
      )}
      renderItem={({ item: bill }) => (
        <BillCard bill={bill} palette={palette} onPress={() => onOpenBill(bill.bill_id)} />
      )}
      ListHeaderComponent={
        <View style={styles.billingListHeader}>
          <DashboardErrorBanner dashboardError={dashboardError} hasShops={hasShops} palette={palette} />
          <View style={styles.headerTitleRow}>
            <View style={styles.headerTitle}>
              <TabSectionHeader
                title="Billing Feed"
                badgeLabel={`${visibleBillCount} bills`}
                badgeBackgroundColor={palette.billingSoft}
                badgeTextColor={palette.billingStrong}
                palette={palette}
              />
            </View>
          </View>
          {hasBills ? (
            <View style={styles.statRow}>
              <BillingStat icon="receipt-text-outline" label="Total" value={`${visibleBillCount}`} palette={palette} />
              <BillingStat icon="playlist-check" label="Shown" value={`${visibleBillsLength}`} palette={palette} tone="neutral" />
              <BillingStat
                icon={dailyBillsHasMore ? "history" : "check-circle-outline"}
                label="Older"
                value={dailyBillsHasMore ? "More" : "Done"}
                palette={palette}
                tone="neutral"
              />
            </View>
          ) : null}
          {hasBills ? (
            <PrintAllButton
              printingAll={printingAll}
              onPrintAll={onPrintAll}
              visibleBillsLength={visibleBillsLength}
              palette={palette}
            />
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <EmptyStateCard
            title="No bills in this range"
            subtitle="This branch and period have no receipts yet."
            actionLabel="Refresh"
            onAction={onRefresh}
            icon="receipt-text-remove-outline"
            palette={palette}
          />
        </View>
      }
      ListFooterComponent={
        dailyBillsLoadingMore ? (
          <View style={[styles.billingListFooter, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
            <ActivityIndicator color={palette.billing} />
            <Text style={[styles.footerText, { color: palette.textMuted }]}>Loading older bills...</Text>
          </View>
        ) : dailyBillsHasMore ? (
          <View style={[styles.billingListFooter, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
            <MaterialCommunityIcons name="history" size={16} color={palette.billing} />
            <Text style={[styles.footerText, { color: palette.textMuted }]}>More bills available</Text>
          </View>
        ) : dailyBillsLength > 0 ? (
          <View style={[styles.billingListFooter, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
            <MaterialCommunityIcons name="check-circle-outline" size={16} color={palette.success} />
            <Text style={[styles.footerText, { color: palette.textMuted }]}>End of billing feed</Text>
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
          tintColor={palette.billing}
          colors={[palette.billing]}
        />
      }
      showsVerticalScrollIndicator={false}
      stickySectionHeadersEnabled={false}
    />
  );
});

const styles = StyleSheet.create({
  billingListHeader: {
    gap: 16,
    marginBottom: 12,
  },
  emptyContainer: {
    flex: 1,
    paddingVertical: 32,
    justifyContent: "center",
  },
  billingListFooter: {
    minHeight: 40,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  footerText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
  },
  statRow: {
    flexDirection: "row",
    gap: 8,
  },
  statChip: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  statLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  statValue: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
    letterSpacing: 0,
  },
  printAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  printAllBtnText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
  },
  billGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    marginBottom: 8,
  },
  billGroupTitle: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  billGroupLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  billCard: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 12,
    padding: 12,
    gap: 12,
    alignItems: "center",
  },
  billIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  billCardBody: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  billCardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  billTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  billCardNo: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    letterSpacing: 0,
  },
  billMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  amountPill: {
    minWidth: 88,
    maxWidth: 132,
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  billCardAmount: {
    maxWidth: "100%",
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
    letterSpacing: 0,
  },
  billCardBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  billActionText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  billCardDate: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    letterSpacing: 0,
  },
});
