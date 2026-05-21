import React, { memo, useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  ListRenderItem,
  Text,
  View,
} from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CartActionBar } from "@/components/ui/cart-action-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { Screen } from "@/components/ui/screen";
import { SectionHeading } from "@/components/ui/section-heading";
import { TextField } from "@/components/ui/text-field";

import { useShopBootstrap } from "@/hooks/use-shop-bootstrap";
import { useShopTranslation } from "@/hooks/use-shop-translation";

import { BillingScreenProps } from "@/navigation/types";

import { resolveApiUrl } from "@/api/client";
import {
  CartItem,
  getCartTotal,
  useCartStore,
} from "@/store/cart-store";
import { usePrinterStore } from "@/store/printer-store";
import { ItemPriceRead, UUID } from "@/types/api";

import { money, toQuantityString } from "@/utils/decimal";
import { formatCurrency, formatUnit } from "@/utils/format";

const ITEM_DISPLAY_ORDER = [
  "Chicken",
  "Chicken without skin",
  "Country Chicken",
  "Duck",
  "Live Country Chicken",
  "Live Chicken",
  "Chicken Cleaning",
] as const;

const ITEM_DISPLAY_ORDER_INDEX = new Map<string, number>(
  ITEM_DISPLAY_ORDER.map((item, index) => [item, index]),
);

type ProductCardProps = {
  item: ItemPriceRead;
  quantity: string;
  itemName: string;
  onChangeQuantity: (itemId: UUID, value: string) => void;
  onAddToCart: (item: ItemPriceRead, quantity: string) => void;
  t: any;
};

const ProductCard = memo(
  ({
    item,
    quantity,
    itemName,
    onChangeQuantity,
    onAddToCart,
    t,
  }: ProductCardProps) => {
    const itemImageUri = item.image_path
      ? resolveApiUrl(item.image_path)
      : "";

    return (
      <Card className="mb-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm shadow-black/5">
        <View className="flex-row gap-4">
          {itemImageUri ? (
            <Image
              source={{ uri: itemImageUri }}
              resizeMode="cover"
              fadeDuration={150}
              className="h-24 w-24 rounded-xl bg-[#F3F4F6]"
            />
          ) : (
            <View className="h-24 w-24 rounded-xl bg-[#F3F4F6]" />
          )}

          <View className="flex-1 justify-between">
            <View>
              <View className="flex-row items-start justify-between gap-2">
                <View className="flex-1">
                  <Text className="text-lg font-semibold text-[#111827]">
                    {itemName}
                  </Text>

                  <Text className="mt-1 text-sm text-[#6B7280]">
                    {item.current_price
                      ? formatCurrency(item.current_price)
                      : t("common.pricePending")}{" "}
                    / {formatUnit(item.base_unit)}
                  </Text>
                </View>
              </View>
            </View>

            <View className="mt-4 gap-3">
              <TextField
                label={
                  item.base_unit === "kg"
                    ? t("common.quantityKg")
                    : t("common.quantityUnits")
                }
                keyboardType="decimal-pad"
                placeholder={
                  item.base_unit === "kg"
                    ? t("common.exampleKg")
                    : t("common.exampleUnits")
                }
                value={quantity}
                onChangeText={(value) =>
                  onChangeQuantity(item.item_id, value)
                }
              />

              <Button
                label={
                  item.current_price
                    ? t("action.addToCart")
                    : t("action.awaitingPrice")
                }
                onPress={() => onAddToCart(item, quantity)}
                disabled={!item.current_price}
                className="h-11 rounded-xl bg-[#163020]"
              />
            </View>
          </View>
        </View>
      </Card>
    );
  },
);

ProductCard.displayName = "ProductCard";

type CartLineProps = {
  item: CartItem;
  itemName: string;
  onRemove: (itemId: UUID) => void;
  t: any;
};

const CartLine = memo(
  ({ item, itemName, onRemove, t }: CartLineProps) => (
    <Card className="mb-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm shadow-black/5">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-base font-semibold text-[#111827]">
            {itemName}
          </Text>
          <Text className="mt-1 text-sm text-[#6B7280]">
            {item.quantity} {formatUnit(item.base_unit)} x {formatCurrency(item.price_per_unit)}
          </Text>
          <Text className="mt-3 text-xs text-[#6B7280]">
            {t("billing.removeLine")}
          </Text>
        </View>

        <View className="items-end gap-3">
          <Text className="text-base font-bold text-[#111827]">
            {formatCurrency(money(item.quantity).mul(money(item.price_per_unit)).toFixed(2))}
          </Text>
          <Button
            label={t("action.remove")}
            onPress={() => onRemove(item.item_id)}
            variant="secondary"
            size="sm"
          />
        </View>
      </View>
    </Card>
  ),
);

CartLine.displayName = "CartLine";

export function BillingScreen({
  navigation,
}: BillingScreenProps) {
  const { bootstrap, loading, error, refresh } =
    useShopBootstrap();

  const { t, translateItemName } = useShopTranslation();

  const cartItems = useCartStore((state) => state.items);
  const preferredPrinter = usePrinterStore((state) => state.preferredPrinter);

  const addItem = useCartStore((state) => state.addItem);

  const removeItem = useCartStore((state) => state.removeItem);

  const [quantities, setQuantities] = useState<
    Record<UUID, string>
  >({});

  const orderedItems = useMemo(() => {
    if (!bootstrap) return [];

    return [...bootstrap.items].sort((a, b) => {
      const left =
        ITEM_DISPLAY_ORDER_INDEX.get(a.item_name) ??
        Number.MAX_SAFE_INTEGER;

      const right =
        ITEM_DISPLAY_ORDER_INDEX.get(b.item_name) ??
        Number.MAX_SAFE_INTEGER;

      return left - right;
    });
  }, [bootstrap]);

  const handleQuantityChange = useCallback(
    (itemId: UUID, value: string) => {
      setQuantities((prev) => ({
        ...prev,
        [itemId]: value,
      }));
    },
    [],
  );

  const handleAddToCart = useCallback(
    (item: ItemPriceRead, quantity: string) => {
      const rawQuantity = quantity.trim();
      const itemName = translateItemName(item.item_name);

      if (!item.current_price) {
        Alert.alert(
          t("billing.alertPriceMissingTitle"),
          t("billing.alertPriceMissingMessage", {
            itemName,
          }),
        );

        return;
      }

      if (
        !rawQuantity ||
        money(rawQuantity).lessThanOrEqualTo(0)
      ) {
        Alert.alert(
          t("billing.alertInvalidQuantityTitle"),
          t("billing.alertInvalidQuantityMessage", {
            itemName,
          }),
        );

        return;
      }

      const cartLine: CartItem = {
        item_id: item.item_id,
        item_name: item.item_name,
        base_unit: item.base_unit,
        unit_type: item.unit_type,
        price_per_unit: item.current_price,
        quantity:
          item.base_unit === "unit"
            ? toQuantityString(rawQuantity, true)
            : rawQuantity,
      };

      addItem(cartLine);

      setQuantities((prev) => ({
        ...prev,
        [item.item_id]: "",
      }));
    },
    [addItem, t, translateItemName],
  );

  const cartTotal = formatCurrency(
    getCartTotal(cartItems),
  );

  const handleRemoveItem = useCallback(
    (itemId: UUID) => {
      removeItem(itemId);
    },
    [removeItem],
  );

  const renderProduct: ListRenderItem<ItemPriceRead> =
    useCallback(
      ({ item }) => (
        <ProductCard
          item={item}
          quantity={quantities[item.item_id] ?? ""}
          itemName={translateItemName(item.item_name)}
          onChangeQuantity={handleQuantityChange}
          onAddToCart={handleAddToCart}
          t={t}
        />
      ),
      [
        quantities,
        translateItemName,
        handleQuantityChange,
        handleAddToCart,
        t,
      ],
    );

  const renderCartFooter = useCallback(
    () => (
      <View className="pb-4">
        <SectionHeading
          eyebrow={t("billing.currentCart")}
          title={t("billing.reviewBeforeCheckout")}
          subtitle={t("billing.reviewBeforeCheckoutSubtitle")}
        />

        {cartItems.length === 0 ? (
          <EmptyState
            title={t("billing.cartEmpty")}
            description={t("billing.cartEmptyDescription")}
          />
        ) : (
          cartItems.map((item) => (
            <CartLine
              key={item.item_id}
              item={item}
              itemName={translateItemName(item.item_name)}
              onRemove={handleRemoveItem}
              t={t}
            />
          ))
        )}

        <Card className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm shadow-black/5">
          <Text className="text-sm font-semibold text-[#111827]">
            {t("common.savedPrinter")}
          </Text>
          <Text className="mt-2 text-sm leading-6 text-[#6B7280]">
            {preferredPrinter
              ? preferredPrinter.name
              : t("printer.noPrinterSavedDescription")}
          </Text>
          <Button
            label={t("action.managePrinter")}
            onPress={() => navigation.navigate("PrinterSetup")}
            variant="secondary"
            className="mt-4"
          />
        </Card>
      </View>
    ),
    [cartItems, handleRemoveItem, navigation, preferredPrinter, t, translateItemName],
  );

  if (loading && !bootstrap) {
    return (
      <LoadingState
        fullscreen
        label={t("billing.loadingPrices")}
      />
    );
  }

  if (error && !bootstrap) {
    return (
      <Screen>
        <EmptyState
          title={t("billing.unableToLoadShopData")}
          description={error}
        />

        <Button
          label={t("action.tryAgain")}
          onPress={() => void refresh()}
          className="mt-4"
        />
      </Screen>
    );
  }

  return (
    <View className="flex-1 bg-[#F7F7F5]">
      <Screen scroll={false}>
        
        <FlatList
          style={{ flex: 1 }}
          data={orderedItems}
          renderItem={renderProduct}
          keyExtractor={(item) =>
            item.item_id.toString()
          }
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          updateCellsBatchingPeriod={48}
          windowSize={5}
          contentContainerStyle={{
            paddingBottom: 180,
          }}
          ListFooterComponent={renderCartFooter}
          ListEmptyComponent={
            <EmptyState
              title={t("billing.unableToLoadShopData")}
              description={t(
                "billing.cartEmptyDescription",
              )}
            />
          }
        />
      </Screen>

      <CartActionBar
        total={cartTotal}
        label={
          cartItems.length === 0
            ? t("action.addItemsFirst")
            : t("action.proceedToCheckout")
        }
        disabled={cartItems.length === 0}
        onPress={() =>
          navigation.navigate("Checkout")
        }
        hideWhenKeyboardVisible
      />
    </View>
  );
}
