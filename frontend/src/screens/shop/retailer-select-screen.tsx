import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { memo, useCallback, useLayoutEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, TextInput, View } from "react-native";

import { fetchShopRetailers } from "@/api/retailers";
import { fetchAllShopRetailerSales } from "@/api/retailer-sales";
import { formatApiErrorMessage } from "@/api/client";
import { ShopHeaderActions } from "@/components/shop-header";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { Screen } from "@/components/ui/screen";
import { ShopText as Text } from "@/components/ui/shop-text";
import { appTheme } from "@/constants/theme";
import { useShopHeaderMenu } from "@/hooks/use-shop-header-menu";
import { useShopTranslation } from "@/hooks/use-shop-translation";
import type { RetailerSelectScreenProps } from "@/navigation/types";
import { useRetailerCartStore } from "@/store/retailer-cart-store";
import type { RetailerRead } from "@/types/api";
import { money } from "@/utils/decimal";
import { formatCurrency } from "@/utils/format";
import { isPendingRetailerSale } from "@/utils/retailer-sale";

function matchesRetailerQuery(retailer: RetailerRead, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const name = retailer.name.toLowerCase();
  const shopName = (retailer.shop_name ?? "").toLowerCase();
  const phone = (retailer.phone ?? "").toLowerCase();
  const altPhone = (retailer.alternate_phone ?? "").toLowerCase();
  return (
    name.includes(needle)
    || shopName.includes(needle)
    || phone.includes(needle)
    || altPhone.includes(needle)
  );
}

const SearchAndBillsRow = memo(function SearchAndBillsRow({
  value,
  onChangeText,
  placeholder,
  billsLabel,
  pendingCount,
  onPressBills,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  billsLabel: string;
  pendingCount: number;
  onPressBills: () => void;
}) {
  return (
    <View className="mb-3 flex-row items-stretch gap-2.5">
      <View
        className="min-h-[48px] flex-row items-center gap-2 rounded-card border border-border bg-card px-3"
        style={{ flex: 7 }}
      >
        <MaterialCommunityIcons name="magnify" size={18} color={appTheme.muted} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={appTheme.muted}
          className="min-w-0 flex-1 py-2 text-[15px] leading-5 text-ink"
          accessibilityLabel={placeholder}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="never"
        />
        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={12}
            onPress={() => onChangeText("")}
          >
            <MaterialCommunityIcons name="close-circle" size={18} color={appTheme.muted} />
          </Pressable>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={billsLabel}
        onPress={onPressBills}
        className="min-h-[48px] items-center justify-center rounded-card bg-accent px-2 active:opacity-90"
        style={{ flex: 3 }}
      >
        <View className="flex-row items-center gap-1.5">
          <MaterialCommunityIcons name="receipt" size={18} color="#FFFFFF" />
          <Text className="text-sm font-bold text-white" numberOfLines={1}>
            {billsLabel}
          </Text>
          {pendingCount > 0 ? (
            <View className="min-w-[18px] items-center rounded-full bg-white/25 px-1.5 py-0.5">
              <Text className="text-[11px] font-bold text-white">{pendingCount}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
});

const RetailerRow = memo(function RetailerRow({
  item,
  outstandingLabel,
  billActionLabel,
  onPress,
}: {
  item: RetailerRead;
  outstandingLabel: string | null;
  billActionLabel: string;
  onPress: () => void;
}) {
  const phones = [item.phone, item.alternate_phone].filter(Boolean).join(" · ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}. ${billActionLabel}`}
      onPress={onPress}
      className="mb-3 overflow-hidden rounded-card border border-border bg-card active:opacity-90"
    >
      <View className="flex-row items-start gap-3 p-4">
        <View className="h-10 w-10 items-center justify-center rounded-control bg-surface">
          <MaterialCommunityIcons name="storefront-outline" size={20} color={appTheme.accentDeep} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-base font-semibold text-ink" numberOfLines={2}>
            {item.name}
          </Text>
          {item.shop_name ? (
            <Text className="mt-0.5 text-sm font-medium text-muted" numberOfLines={1}>
              {item.shop_name}
            </Text>
          ) : null}
          {outstandingLabel ? (
            <Text className="mt-1.5 text-sm font-semibold text-amber-900">{outstandingLabel}</Text>
          ) : null}
          {phones ? <Text className="mt-1 text-sm text-muted">{phones}</Text> : null}
        </View>
        <MaterialCommunityIcons name="chevron-right" size={22} color={appTheme.muted} />
      </View>
      <View className="flex-row items-center justify-between border-t border-border bg-surface/60 px-4 py-2.5">
        <Text className="text-sm font-bold text-accent">{billActionLabel}</Text>
        <MaterialCommunityIcons name="cart-plus" size={16} color={appTheme.accent} />
      </View>
    </Pressable>
  );
});

export function RetailerSelectScreen({ navigation }: RetailerSelectScreenProps) {
  const { t } = useShopTranslation();
  const [retailers, setRetailers] = useState<RetailerRead[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const setRetailer = useRetailerCartStore((s) => s.setRetailer);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const shopRetailers = await fetchShopRetailers();
      setRetailers(shopRetailers);
      const allSales = await fetchAllShopRetailerSales();
      const pending = allSales.filter(isPendingRetailerSale);
      setPendingCount(pending.length);
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

  const filteredRetailers = useMemo(
    () => retailers.filter((retailer) => matchesRetailerQuery(retailer, searchQuery)),
    [retailers, searchQuery],
  );

  const openSales = useCallback(() => {
    navigation.navigate("RetailerSales");
  }, [navigation]);

  const listHeader = useMemo(
    () => (
      <View>
        <SearchAndBillsRow
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t("retailers.searchRetailerOrShop")}
          billsLabel={t("retailers.billsButton")}
          pendingCount={pendingCount}
          onPressBills={openSales}
        />
        <Text className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
          {t("retailers.selectToBill")}
        </Text>
      </View>
    ),
    [openSales, pendingCount, searchQuery, t],
  );

  if (loading) return <LoadingState label={t("retailers.loading")} />;

  return (
    <View className="flex-1 bg-cream">
      <Screen scroll={false} topInset={false} contentTopPadding={4}>
        <FlatList
          style={{ flex: 1 }}
          data={filteredRetailers}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            retailers.length === 0 ? (
              <Text className="text-muted">{t("retailers.empty")}</Text>
            ) : (
              <EmptyState
                title={t("retailers.searchNoResults")}
                description={t("retailers.searchNoResultsHint")}
                actionLabel={t("retailers.clearSearch")}
                onAction={() => setSearchQuery("")}
              />
            )
          }
          contentContainerStyle={{ paddingBottom: 24 }}
          renderItem={({ item }) => (
            <RetailerRow
              item={item}
              outstandingLabel={
                money(item.outstanding_balance ?? 0).greaterThan(0)
                  ? t("retailers.outstandingAvailable", {
                      amount: formatCurrency(item.outstanding_balance),
                    })
                  : null
              }
              billActionLabel={t("retailers.startBilling")}
              onPress={() => {
                setRetailer(item.id, item.name);
                navigation.navigate("RetailerBilling", {
                  retailerId: item.id,
                  retailerName: item.name,
                });
              }}
            />
          )}
        />
      </Screen>
    </View>
  );
}
