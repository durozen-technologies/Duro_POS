import { useFocusEffect } from "@react-navigation/native";
import { memo, useCallback, useLayoutEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fetchAllShopRetailerSales } from "@/api/retailer-sales";
import { toApiError } from "@/api/client";
import { ShopHeaderActions } from "@/components/shop-header";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { Screen } from "@/components/ui/screen";
import { StatusPill } from "@/components/ui/status-pill";
import { appTheme } from "@/constants/theme";
import { useShopHeaderMenu } from "@/hooks/use-shop-header-menu";
import { useShopTranslation, type ShopTranslationKey } from "@/hooks/use-shop-translation";
import type { RetailerSalesScreenProps } from "@/navigation/types";
import { RetailerSaleStatus, type RetailerSaleRead } from "@/types/api";
import { money } from "@/utils/decimal";
import { formatCurrency, formatDateTime } from "@/utils/format";
import {
  formatRetailerSaleNoDisplay,
  isPendingRetailerSale,
  isSettledRetailerSale,
  sortRetailerSalesByNo,
} from "@/utils/retailer-sale";

type SalesTab = "pending" | "paid";

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: "row",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.background,
    padding: 4,
  },
  tab: {
    minHeight: 48,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  tabActive: {
    backgroundColor: appTheme.card,
    borderWidth: 1,
    borderColor: appTheme.border,
  },
  tabLabel: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: "700",
    color: appTheme.muted,
  },
  tabLabelActive: {
    color: appTheme.accent,
  },
  tabCount: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "600",
    color: appTheme.muted,
  },
  tabCountActive: {
    color: appTheme.accentDeep,
  },
  summaryCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  summaryLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: appTheme.muted,
  },
  summaryValue: {
    marginTop: 4,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "800",
    color: appTheme.text,
  },
  summaryMeta: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    color: appTheme.muted,
  },
  saleCard: {
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appTheme.border,
    backgroundColor: appTheme.card,
    overflow: "hidden",
  },
  saleHeader: {
    borderBottomWidth: 1,
    borderBottomColor: appTheme.border,
    backgroundColor: appTheme.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  saleHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  saleNo: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
    color: appTheme.text,
    fontVariant: ["tabular-nums"],
  },
  saleRetailer: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: appTheme.text,
  },
  saleMeta: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: appTheme.muted,
  },
  saleBody: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  amountLabel: {
    fontSize: 14,
    lineHeight: 18,
    color: appTheme.muted,
  },
  amountValue: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
    color: appTheme.text,
  },
  highlightRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  highlightPending: {
    borderColor: "#E8C98E",
    backgroundColor: appTheme.warningSoft,
  },
  highlightPaid: {
    borderColor: "#B9D5C3",
    backgroundColor: appTheme.successSoft,
  },
  highlightLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
  },
  highlightValue: {
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
  },
});

function saleStatusLabel(status: RetailerSaleStatus, t: (key: ShopTranslationKey) => string) {
  switch (status) {
    case RetailerSaleStatus.SETTLED:
      return t("retailers.statusSettled");
    case RetailerSaleStatus.PARTIAL:
      return t("retailers.statusPartial");
    case RetailerSaleStatus.OPEN:
      return t("retailers.statusOpen");
    default:
      return status;
  }
}

function saleStatusTone(status: RetailerSaleStatus): "success" | "warning" | "neutral" {
  if (status === RetailerSaleStatus.SETTLED) return "success";
  if (status === RetailerSaleStatus.PARTIAL) return "warning";
  return "neutral";
}

function latestPaymentAt(sale: RetailerSaleRead) {
  if (sale.payments.length === 0) {
    return sale.created_at;
  }
  return sale.payments.reduce((latest, payment) => {
    return new Date(payment.paid_at).getTime() > new Date(latest).getTime() ? payment.paid_at : latest;
  }, sale.payments[0].paid_at);
}

type SalesTabBarProps = {
  tab: SalesTab;
  options: { key: SalesTab; label: string; count: number }[];
  onChange: (tab: SalesTab) => void;
};

const SalesTabBar = memo(function SalesTabBar({ tab, options, onChange }: SalesTabBarProps) {
  return (
    <View style={styles.tabBar}>
      {options.map((option) => {
        const active = tab === option.key;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.key)}
            style={({ pressed }) => [styles.tab, active ? styles.tabActive : null, pressed ? { opacity: 0.78 } : null]}
          >
            <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]} numberOfLines={2}>
              {option.label}
            </Text>
            <Text style={[styles.tabCount, active ? styles.tabCountActive : null]}>{option.count}</Text>
          </Pressable>
        );
      })}
    </View>
  );
});

type SaleRowProps = {
  sale: RetailerSaleRead;
  tab: SalesTab;
  onPress: () => void;
  t: (key: ShopTranslationKey, params?: Record<string, string | number>) => string;
};

const SaleRow = memo(function SaleRow({ sale, tab, onPress, t }: SaleRowProps) {
  const pending = tab === "pending";
  const paymentCount = sale.payments.length;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.saleCard, pressed ? { opacity: 0.9 } : null]}
    >
      <View style={styles.saleHeader}>
        <View style={styles.saleHeaderText}>
          <Text style={styles.saleNo} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
            {formatRetailerSaleNoDisplay(sale.sale_no)}
          </Text>
          <Text style={styles.saleRetailer} numberOfLines={1}>
            {sale.retailer_name}
          </Text>
          <Text style={styles.saleMeta}>{formatDateTime(sale.created_at)}</Text>
          {!pending && paymentCount > 0 ? (
            <Text style={styles.saleMeta}>
              {t("retailers.paymentsCount", { count: String(paymentCount) })} · {t("retailers.lastPayment")}{" "}
              {formatDateTime(latestPaymentAt(sale))}
            </Text>
          ) : null}
        </View>
        <StatusPill label={saleStatusLabel(sale.status, t)} tone={saleStatusTone(sale.status)} />
      </View>

      <View style={styles.saleBody}>
        <View style={styles.amountRow}>
          <Text style={styles.amountLabel}>{t("billing.cartLiveTotal")}</Text>
          <Text style={styles.amountValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {formatCurrency(sale.total_amount)}
          </Text>
        </View>
        <View style={styles.amountRow}>
          <Text style={styles.amountLabel}>{t("common.paidAmount")}</Text>
          <Text style={styles.amountValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {formatCurrency(sale.amount_paid_total)}
          </Text>
        </View>
        {pending ? (
          <View style={[styles.highlightRow, styles.highlightPending]}>
            <Text style={[styles.highlightLabel, { color: "#7A4E12" }]}>{t("retailers.balanceDue")}</Text>
            <Text
              style={[styles.highlightValue, { color: "#7A4E12" }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {formatCurrency(sale.balance_due)}
            </Text>
          </View>
        ) : (
          <View style={[styles.highlightRow, styles.highlightPaid]}>
            <Text style={[styles.highlightLabel, { color: appTheme.success }]}>{t("retailers.fullySettled")}</Text>
            <Text style={[styles.highlightValue, { color: appTheme.success }]}>
              {formatCurrency(sale.total_amount)}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
});

type SalesListHeaderProps = {
  tab: SalesTab;
  tabOptions: { key: SalesTab; label: string; count: number }[];
  onTabChange: (tab: SalesTab) => void;
  pendingSalesCount: number;
  pendingBalanceTotal: string;
  paidSalesCount: number;
  paidSalesTotal: string;
  t: (key: ShopTranslationKey, params?: Record<string, string | number>) => string;
};

const SalesListHeader = memo(function SalesListHeader({
  tab,
  tabOptions,
  onTabChange,
  pendingSalesCount,
  pendingBalanceTotal,
  paidSalesCount,
  paidSalesTotal,
  t,
}: SalesListHeaderProps) {
  const pending = tab === "pending";

  return (
    <View style={{ marginBottom: 16, gap: 12 }}>
      <SalesTabBar tab={tab} options={tabOptions} onChange={onTabChange} />

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>
          {pending ? t("retailers.pendingBalanceTotal") : t("retailers.paidSalesSummary")}
        </Text>
        <Text
          style={styles.summaryValue}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {formatCurrency(pending ? pendingBalanceTotal : paidSalesTotal)}
        </Text>
        <Text style={styles.summaryMeta}>
          {pending
            ? t("retailers.pendingSalesCount", { count: String(pendingSalesCount) })
            : t("retailers.paidSalesCount", { count: String(paidSalesCount) })}
        </Text>
      </View>
    </View>
  );
});

export function RetailerSalesScreen({ navigation }: RetailerSalesScreenProps) {
  const { t } = useShopTranslation();
  const [sales, setSales] = useState<RetailerSaleRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<SalesTab>("pending");

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      setSales(
        sortRetailerSalesByNo(
          (await fetchAllShopRetailerSales()).filter(
            (sale) => sale.status !== RetailerSaleStatus.VOID,
          ),
        ),
      );
    } catch (error) {
      Alert.alert(t("retailers.loadFailed"), toApiError(error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void load({ silent: true });
  }, [load]);

  const headerMenu = useShopHeaderMenu(navigation, {
    onRefresh: handleRefresh,
    refreshing: loading || refreshing,
  });

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <ShopHeaderActions {...headerMenu} />,
    });
  }, [headerMenu, navigation]);

  const pendingSales = useMemo(() => sales.filter(isPendingRetailerSale), [sales]);
  const paidSales = useMemo(() => sales.filter(isSettledRetailerSale), [sales]);
  const visibleSales = tab === "pending" ? pendingSales : paidSales;

  const pendingBalanceTotal = useMemo(
    () =>
      pendingSales.reduce((sum, sale) => sum.plus(money(sale.balance_due)), money(0)).toFixed(2),
    [pendingSales],
  );

  const paidSalesTotal = useMemo(
    () =>
      paidSales.reduce((sum, sale) => sum.plus(money(sale.total_amount)), money(0)).toFixed(2),
    [paidSales],
  );

  const tabOptions = useMemo(
    () => [
      { key: "pending" as const, label: t("retailers.tabPending"), count: pendingSales.length },
      { key: "paid" as const, label: t("retailers.tabPaid"), count: paidSales.length },
    ],
    [paidSales.length, pendingSales.length, t],
  );

  const listHeader = useMemo(
    () => (
      <SalesListHeader
        tab={tab}
        tabOptions={tabOptions}
        onTabChange={setTab}
        pendingSalesCount={pendingSales.length}
        pendingBalanceTotal={pendingBalanceTotal}
        paidSalesCount={paidSales.length}
        paidSalesTotal={paidSalesTotal}
        t={t}
      />
    ),
    [
      tab,
      tabOptions,
      pendingSales.length,
      pendingBalanceTotal,
      paidSales.length,
      paidSalesTotal,
      t,
    ],
  );

  const handleSalePress = useCallback(
    (saleId: string) => {
      navigation.navigate("RetailerSaleDetail", { saleId });
    },
    [navigation],
  );

  if (loading && sales.length === 0) {
    return <LoadingState label={t("retailers.loadingSales")} />;
  }

  return (
    <View className="flex-1 bg-cream">
      <Screen scroll={false} topInset={false} contentTopPadding={4}>
        <FlatList
          style={{ flex: 1 }}
          data={visibleSales}
          keyExtractor={(item) => item.id}
          extraData={tab}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#4B6356" />
          }
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <EmptyState
              title={tab === "pending" ? t("retailers.salesEmptyPending") : t("retailers.salesEmptyPaid")}
              description={
                tab === "pending"
                  ? t("retailers.salesEmptyPendingHint")
                  : t("retailers.salesEmptyPaidHint")
              }
            />
          }
          contentContainerStyle={{ paddingBottom: 24, flexGrow: visibleSales.length === 0 ? 1 : undefined }}
          renderItem={({ item }) => (
            <SaleRow sale={item} tab={tab} t={t} onPress={() => handleSalePress(item.id)} />
          )}
        />
      </Screen>
    </View>
  );
}
