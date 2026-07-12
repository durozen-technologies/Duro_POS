import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { memo, useCallback, useLayoutEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, TextInput, View } from "react-native";

import { fetchRetailerCatalog } from "@/api/retailer-sales";
import { toApiError, formatApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CartActionBar } from "@/components/ui/cart-action-bar";
import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import { LoadingState } from "@/components/ui/loading-state";
import { Screen } from "@/components/ui/screen";
import { SectionHeading } from "@/components/ui/section-heading";
import { ShopHeaderActions } from "@/components/shop-header";
import { useShopHeaderMenu } from "@/hooks/use-shop-header-menu";
import {
  getLocalizedItemName,
  useShopTranslation,
} from "@/hooks/use-shop-translation";
import type { RetailerBillingScreenProps } from "@/navigation/types";
import {
  getRetailerCartTotal,
  useRetailerCartStore,
  type RetailerCartItem,
} from "@/store/retailer-cart-store";
import { BaseUnit, type RetailerCatalogItemRead, type UUID } from "@/types/api";
import { money, toQuantityString } from "@/utils/decimal";
import { formatCurrency, formatUnit } from "@/utils/format";
import { getItemThumbnailUri, prefetchItemThumbnails } from "@/utils/item-images";
import { ShopText as Text } from "@/components/ui/shop-text";

type CatalogCardProps = {
  item: RetailerCatalogItemRead;
  quantity: string;
  itemName: string;
  tamilName?: string | null;
  priceText: string;
  buttonLabel: string;
  onChangeQuantity: (itemId: UUID, value: string) => void;
  onAddToCart: (item: RetailerCatalogItemRead) => void;
};

const CatalogCard = memo(function CatalogCard({
  item,
  quantity,
  itemName,
  tamilName,
  priceText,
  buttonLabel,
  onChangeQuantity,
  onAddToCart,
}: CatalogCardProps) {
  const imageUri = getItemThumbnailUri(item);

  return (
    <Card className="mb-4 overflow-hidden">
      <View className="flex-row gap-3">
        {imageUri ? (
          <View
            className="w-[108px] overflow-hidden rounded-control border border-border bg-surface"
            style={{ aspectRatio: 1 }}
          >
            <ItemThumbnail
              uri={imageUri}
              recyclingKey={item.item_id}
              size={108}
              borderRadius={8}
              backgroundColor="#E6EFE9"
              icon="food-drumstick-outline"
              iconColor="#4B6356"
              iconSize={28}
            />
          </View>
        ) : (
          <View
            className="w-[108px] items-center justify-center rounded-control border border-dashed border-border bg-surface"
            style={{ aspectRatio: 1 }}
          >
            <MaterialCommunityIcons name="food-drumstick-outline" size={28} color="#4B6356" />
          </View>
        )}
        <View className="min-w-0 flex-1">
          <Text className="text-[17px] font-bold leading-6 text-ink" numberOfLines={2}>
            {itemName}
          </Text>
          {tamilName ? (
            <Text className="mt-0.5 text-sm text-muted" numberOfLines={1}>
              {tamilName}
            </Text>
          ) : null}
          <Text className="mt-1 text-sm font-semibold tabular-nums text-ink">{priceText}</Text>
          <View className="mt-3 flex-row items-center gap-2">
            <TextInput
              className="min-w-[72px] flex-1 rounded-control border border-border px-3 py-2 text-ink"
              keyboardType={item.item_base_unit === BaseUnit.UNIT ? "number-pad" : "decimal-pad"}
              placeholder="Qty"
              value={quantity}
              onChangeText={(value) => onChangeQuantity(item.item_id, value)}
            />
            <Button label={buttonLabel} onPress={() => onAddToCart(item)} />
          </View>
        </View>
      </View>
    </Card>
  );
});

export function RetailerBillingScreen({ navigation, route }: RetailerBillingScreenProps) {
  const { retailerId, retailerName } = route.params;
  const { language, t } = useShopTranslation();
  const [catalog, setCatalog] = useState<RetailerCatalogItemRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const cartItems = useRetailerCartStore((s) => s.items);
  const addItem = useRetailerCartStore((s) => s.addItem);
  const removeItem = useRetailerCartStore((s) => s.removeItem);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await fetchRetailerCatalog(retailerId);
      setCatalog(items);
      prefetchItemThumbnails(items);
    } catch (error) {
      Alert.alert(t("retailers.loadFailed"), formatApiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [retailerId, t]);

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
      headerTitle: retailerName,
      headerRight: () => <ShopHeaderActions {...headerMenu} />,
    });
  }, [headerMenu, navigation, retailerName]);

  const total = useMemo(() => getRetailerCartTotal(cartItems), [cartItems]);

  const addToCart = useCallback(
    (item: RetailerCatalogItemRead) => {
      const rawQty = quantities[item.item_id] ?? "";
      if (!rawQty || money(rawQty).lessThanOrEqualTo(0)) {
        Alert.alert(
          t("billing.alertInvalidQuantityTitle"),
          t("billing.alertInvalidQuantityMessage", { itemName: item.item_name }),
        );
        return;
      }
      const line: RetailerCartItem = {
        item_id: item.item_id,
        item_name: item.item_name,
        item_tamil_name: item.item_tamil_name,
        base_unit: item.item_base_unit,
        unit_type: item.item_unit_type,
        price_per_unit: item.price_per_unit,
        quantity: toQuantityString(rawQty, item.item_base_unit === BaseUnit.UNIT),
      };
      addItem(line);
      setQuantities((current) => ({ ...current, [item.item_id]: "" }));
    },
    [addItem, quantities, t],
  );

  const renderCartFooter = useCallback(
    () =>
      cartItems.length === 0 ? null : (
        <View className="pb-4 pt-2">
          <SectionHeading title={t("billing.reviewBeforeCheckout")} />
          {cartItems.map((line) => {
            const lineTotal = money(line.price_per_unit).mul(money(line.quantity)).toFixed(2);
            const displayName = getLocalizedItemName(
              language,
              line.item_name,
              line.item_tamil_name,
            );
            return (
              <Card key={line.item_id} className="mb-2 flex-row items-center justify-between gap-3 p-3">
                <View className="min-w-0 flex-1">
                  <Text className="font-semibold text-ink" numberOfLines={2}>
                    {displayName}
                  </Text>
                  <Text className="text-sm text-muted">
                    {line.quantity} {formatUnit(line.base_unit)} × {formatCurrency(line.price_per_unit)}
                  </Text>
                </View>
                <View className="items-end gap-1">
                  <Text className="font-semibold text-ink">{formatCurrency(lineTotal)}</Text>
                  <Pressable onPress={() => removeItem(line.item_id)} hitSlop={8}>
                    <Text className="text-sm font-semibold text-danger">{t("action.remove")}</Text>
                  </Pressable>
                </View>
              </Card>
            );
          })}
        </View>
      ),
    [cartItems, language, removeItem, t],
  );

  if (loading) return <LoadingState label={t("retailers.loadingCatalog")} />;

  return (
    <View className="flex-1 bg-cream">
      <Screen scroll={false} topInset={false} contentTopPadding={4}>
        <FlatList
          style={{ flex: 1 }}
          data={catalog}
          keyExtractor={(item) => item.item_id}
          contentContainerStyle={{ paddingBottom: cartItems.length > 0 ? 220 : 120 }}
          ListEmptyComponent={<Text className="text-muted">{t("retailers.noItemsMapped")}</Text>}
          ListFooterComponent={renderCartFooter}
          renderItem={({ item }) => (
            <CatalogCard
              item={item}
              quantity={quantities[item.item_id] ?? ""}
              itemName={getLocalizedItemName(language, item.item_name, item.item_tamil_name)}
              tamilName={language === "en" ? item.item_tamil_name : null}
              priceText={formatCurrency(item.price_per_unit)}
              buttonLabel={t("action.addToCart")}
              onChangeQuantity={(itemId, value) =>
                setQuantities((current) => ({ ...current, [itemId]: value }))
              }
              onAddToCart={addToCart}
            />
          )}
        />
      </Screen>
      <CartActionBar
        total={formatCurrency(total)}
        label={t("action.proceedToCheckout")}
        disabled={cartItems.length === 0}
        onPress={() => {
          if (cartItems.length === 0) return;
          navigation.navigate("RetailerCheckout", { retailerId, retailerName });
        }}
      />
    </View>
  );
}
