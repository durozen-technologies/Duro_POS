import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";

import { fetchShopRetailers } from "@/api/retailers";
import { fetchAllShopRetailerSales } from "@/api/retailer-sales";
import { toApiError, formatApiErrorMessage } from "@/api/client";
import { ShopHeaderActions } from "@/components/shop-header";
import { LoadingState } from "@/components/ui/loading-state";
import { Screen } from "@/components/ui/screen";
import { useShopHeaderMenu } from "@/hooks/use-shop-header-menu";
import { useShopTranslation } from "@/hooks/use-shop-translation";
import type { RetailerSelectScreenProps } from "@/navigation/types";
import { useRetailerCartStore } from "@/store/retailer-cart-store";
import type { RetailerRead } from "@/types/api";
import { formatCurrency } from "@/utils/format";
import { isPendingRetailerSale } from "@/utils/retailer-sale";
import { money } from "@/utils/decimal";

export function RetailerSelectScreen({ navigation }: RetailerSelectScreenProps) {
  const { t } = useShopTranslation();
  const [retailers, setRetailers] = useState<RetailerRead[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingBalance, setPendingBalance] = useState("0.00");
  const [loading, setLoading] = useState(true);
  const setRetailer = useRetailerCartStore((s) => s.setRetailer);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRetailers(await fetchShopRetailers());
      const allSales = await fetchAllShopRetailerSales();
      const pending = allSales.filter(isPendingRetailerSale);
      setPendingCount(pending.length);
      setPendingBalance(
        pending.reduce((sum, sale) => sum.plus(money(sale.balance_due)), money(0)).toFixed(2),
      );
    } catch (error) {
      Alert.alert(t("retailers.loadFailed"), formatApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleRefresh = useCallback(() => {
    void load();
  }, [load]);

  const headerMenu = useShopHeaderMenu(navigation, {
    onRefresh: handleRefresh,
    refreshing: loading,
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

  const salesBanner = useMemo(() => {
    if (pendingCount <= 0) {
      return (
        <Pressable
          className="mb-4 rounded-card border border-border bg-card px-4 py-3 active:opacity-90"
          onPress={() => navigation.navigate("RetailerSales")}
        >
          <Text className="text-sm font-bold text-accent">{t("retailers.viewAllSales")}</Text>
        </Pressable>
      );
    }

    return (
      <Pressable
        className="mb-4 overflow-hidden rounded-card border border-amber-200 bg-warningSoft active:opacity-90"
        onPress={() => navigation.navigate("RetailerSales")}
      >
        <View className="border-b border-amber-200 bg-warningSoft px-4 py-3">
          <Text className="text-xs font-bold uppercase tracking-wide text-amber-900">
            {t("retailers.openSales")}
          </Text>
          <Text
            className="mt-1 text-xl font-bold text-amber-950"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {formatCurrency(pendingBalance)}
          </Text>
          <Text className="mt-1 text-xs text-amber-900">
            {t("retailers.pendingSalesCount", { count: String(pendingCount) })}
          </Text>
        </View>
        <View className="px-4 py-3">
          <Text className="text-sm font-bold text-accentDeep">{t("retailers.viewAllSales")}</Text>
        </View>
      </Pressable>
    );
  }, [navigation, pendingBalance, pendingCount, t]);

  if (loading) return <LoadingState label={t("retailers.loading")} />;

  return (
    <View className="flex-1 bg-cream">
      <Screen scroll={false} topInset={false} contentTopPadding={4}>
        <FlatList
          style={{ flex: 1 }}
          data={retailers}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={salesBanner}
          ListEmptyComponent={<Text className="text-muted">{t("retailers.empty")}</Text>}
          contentContainerStyle={{ paddingBottom: 24 }}
          renderItem={({ item }) => (
            <Pressable
              className="mb-3 rounded-card border border-border bg-card p-4"
              onPress={() => {
                setRetailer(item.id, item.name);
                navigation.navigate("RetailerBilling", {
                  retailerId: item.id,
                  retailerName: item.name,
                });
              }}
            >
              <Text className="text-base font-semibold text-ink">{item.name}</Text>
              {item.phone ? <Text className="mt-1 text-sm text-muted">{item.phone}</Text> : null}
            </Pressable>
          )}
        />
      </Screen>
    </View>
  );
}
