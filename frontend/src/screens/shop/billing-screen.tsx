import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  ListRenderItem,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CartActionBar } from "@/components/ui/cart-action-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import { LoadingState } from "@/components/ui/loading-state";
import { Screen } from "@/components/ui/screen";
import { SectionHeading } from "@/components/ui/section-heading";
import { TextField } from "@/components/ui/text-field";
import { ShopHeaderActions } from "@/components/shop-header";

import { useShopBootstrap } from "@/hooks/use-shop-bootstrap";
import {
  getLocalizedItemName,
  useShopTranslation,
} from "@/hooks/use-shop-translation";

import { BillingScreenProps } from "@/navigation/types";

import {
  CartItem,
  getCartTotal,
  useCartStore,
} from "@/store/cart-store";
import { useAuthStore } from "@/store/auth-store";
import { usePriceStore } from "@/store/price-store";
import { BaseUnit, ItemPriceRead, UUID } from "@/types/api";

import { money, toQuantityString } from "@/utils/decimal";
import { formatCurrency, formatUnit } from "@/utils/format";
import { cn } from "@/utils/cn";
import { getItemThumbnailUri, prefetchItemThumbnails } from "@/utils/item-images";

type ProductCardProps = {
  item: ItemPriceRead;
  quantity: string;
  itemName: string;
  priceText: string;
  quantityLabel: string;
  quantityPlaceholder: string;
  buttonLabel: string;
  onChangeQuantity: (itemId: UUID, value: string) => void;
  onAddToCart: (item: ItemPriceRead, quantity: string) => void;
};

type CatalogueOption = {
  key: string;
  label: string;
  count: number;
  isUncategorized?: boolean;
};

type CatalogueDropdownProps = {
  label: string;
  selectedLabel: string;
  itemCountLabel: string;
  options: CatalogueOption[];
  selectedKey: string | null;
  open: boolean;
  onToggle: () => void;
  onSelect: (key: string) => void;
};

const UNCATEGORIZED_CATALOGUE_KEY = "uncategorized-catalogue";

function getCatalogueKey(item: ItemPriceRead) {
  const categoryId = item.category_id?.trim();
  if (categoryId) {
    return `category-id:${categoryId}`;
  }

  const categoryName = item.category?.trim();
  if (categoryName) {
    return `category-name:${categoryName.toLocaleLowerCase()}`;
  }

  return UNCATEGORIZED_CATALOGUE_KEY;
}

const CatalogueDropdown = memo(function CatalogueDropdown({
  label,
  selectedLabel,
  itemCountLabel,
  options,
  selectedKey,
  open,
  onToggle,
  onSelect,
}: CatalogueDropdownProps) {
  return (
    <View className="mb-4">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        className="rounded-[18px] border border-border bg-card px-4 py-3 shadow-soft"
      >
        <View className="flex-row items-center gap-3">
          <View className="h-10 w-10 items-center justify-center rounded-[14px] bg-accentSoft">
            <MaterialCommunityIcons name="filter-variant" size={20} color="#147D52" />
          </View>

          <View className="min-w-0 flex-1">
            <Text className="text-[11px] font-semibold uppercase tracking-[1.2px] text-accentDeep">
              {label}
            </Text>
            <Text className="mt-0.5 text-base font-bold text-ink" numberOfLines={1}>
              {selectedLabel}
            </Text>
          </View>

          <Text className="text-xs font-semibold text-muted" numberOfLines={1}>
            {itemCountLabel}
          </Text>

          <MaterialCommunityIcons
            name={open ? "chevron-up" : "chevron-down"}
            size={22}
            color="#6C7A70"
          />
        </View>
      </Pressable>

      {open ? (
        <View className="mt-2 overflow-hidden rounded-[18px] border border-border bg-card shadow-soft">
          {options.map((option, index) => {
            const selected = option.key === selectedKey;
            const optionIcon = option.isUncategorized
              ? "tag-off-outline"
              : "tag-outline";

            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => onSelect(option.key)}
                className={cn(
                  "flex-row items-center gap-3 px-4 py-3",
                  index < options.length - 1 && "border-b border-border/60",
                  selected && "bg-accentSoft",
                )}
              >
                <MaterialCommunityIcons
                  name={optionIcon}
                  size={18}
                  color={selected ? "#147D52" : "#6C7A70"}
                />
                <Text
                  className={cn(
                    "min-w-0 flex-1 text-sm font-semibold",
                    selected ? "text-accentDeep" : "text-ink",
                  )}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
                <Text className="text-xs font-semibold text-muted">
                  {option.count}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
});

const ProductCard = memo(
  ({
    item,
    quantity,
    itemName,
    priceText,
    quantityLabel,
    quantityPlaceholder,
    buttonLabel,
    onChangeQuantity,
    onAddToCart,
  }: ProductCardProps) => {
    const itemImageUri = getItemThumbnailUri(item);

    const hasPrice = Boolean(item.current_price && money(item.current_price).greaterThan(0));

    return (
      <Card className={cn("mb-4 overflow-hidden", !hasPrice && "opacity-80")}>
        <View className="flex-row gap-3">
          {itemImageUri ? (
            <View
              className="w-[108px] overflow-hidden rounded-[18px] border border-border/70 bg-surface"
              style={{ aspectRatio: 1 }}
            >
              <ItemThumbnail
                uri={itemImageUri}
                recyclingKey={item.item_id}
                size={108}
                borderRadius={18}
                backgroundColor="#F4F7F2"
                icon="food-drumstick-outline"
                iconColor="#6C7A70"
                iconSize={28}
              />
            </View>
          ) : (
            <View
              className="w-[108px] items-center justify-center rounded-[18px] border border-dashed border-border bg-surface"
              style={{ aspectRatio: 1 }}
            >
              <MaterialCommunityIcons name="food-drumstick-outline" size={28} color="#6C7A70" />
            </View>
          )}

          <View className="min-w-0 flex-1">
            <View className="min-w-0">
              <Text className="text-[17px] font-bold leading-6 text-ink" numberOfLines={2}>
                {itemName}
              </Text>

              <Text className="mt-1 text-sm font-semibold text-accentDeep">
                {priceText}
              </Text>
            </View>

            <View className="mt-3 gap-3">
              <TextField
                label={quantityLabel}
                keyboardType="decimal-pad"
                placeholder={quantityPlaceholder}
                value={quantity}
                onChangeText={(value) =>
                  onChangeQuantity(item.item_id, value)
                }
              />

              <Button
                label={buttonLabel}
                onPress={() => onAddToCart(item, quantity)}
                disabled={!hasPrice}
                className={hasPrice ? "border-[#147D52] bg-[#147D52]" : undefined}
              />
            </View>
          </View>
        </View>
      </Card>
    );
  },
  (prev, next) =>
    prev.item.item_id === next.item.item_id &&
    prev.item.current_price === next.item.current_price &&
    prev.item.image_path === next.item.image_path &&
    prev.item.image_thumb_path === next.item.image_thumb_path &&
    prev.quantity === next.quantity &&
    prev.itemName === next.itemName &&
    prev.priceText === next.priceText &&
    prev.quantityLabel === next.quantityLabel &&
    prev.quantityPlaceholder === next.quantityPlaceholder &&
    prev.buttonLabel === next.buttonLabel &&
    prev.onChangeQuantity === next.onChangeQuantity &&
    prev.onAddToCart === next.onAddToCart,
);

ProductCard.displayName = "ProductCard";

type CartLineProps = {
  item: CartItem;
  itemName: string;
  quantitySummary: string;
  totalText: string;
  removeHelpText: string;
  removeButtonLabel: string;
  onRemove: (itemId: UUID) => void;
};

const CartLine = memo(
  ({
    item,
    itemName,
    quantitySummary,
    totalText,
    removeHelpText,
    removeButtonLabel,
    onRemove,
  }: CartLineProps) => (
    <Card className="mb-3">
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-[14px] bg-accentSoft">
          <MaterialCommunityIcons name="basket-outline" size={18} color="#147D52" />
        </View>

        <View className="min-w-0 flex-1">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-base font-bold leading-6 text-ink" numberOfLines={2}>
                {itemName}
              </Text>
              <Text className="mt-1 text-sm leading-5 text-muted">
                {quantitySummary}
              </Text>
            </View>

            <Text className="text-right text-base font-bold text-ink">
              {totalText}
            </Text>
          </View>

          <View className="mt-3 flex-row items-center justify-between gap-3 border-t border-border/70 pt-3">
            <Text className="flex-1 text-xs leading-5 text-muted">
              {removeHelpText}
            </Text>
            <Button
              label={removeButtonLabel}
              onPress={() => onRemove(item.item_id)}
              variant="secondary"
              size="sm"
            />
          </View>
        </View>
      </View>
    </Card>
  ),
  (prev, next) =>
    prev.item.item_id === next.item.item_id &&
    prev.item.quantity === next.item.quantity &&
    prev.item.price_per_unit === next.item.price_per_unit &&
    prev.itemName === next.itemName &&
    prev.quantitySummary === next.quantitySummary &&
    prev.totalText === next.totalText &&
    prev.removeHelpText === next.removeHelpText &&
    prev.removeButtonLabel === next.removeButtonLabel &&
    prev.onRemove === next.onRemove,
);

CartLine.displayName = "CartLine";

export function BillingScreen({
  navigation,
}: BillingScreenProps) {
  const { bootstrap, loading, error, refresh } =
    useShopBootstrap();

  const { language, t } = useShopTranslation();

  const clearSession = useAuthStore((state) => state.clearSession);
  const cartItems = useCartStore((state) => state.items);
  const resetCart = useCartStore((state) => state.resetCart);
  const clearPrices = usePriceStore((state) => state.clear);

  const addItem = useCartStore((state) => state.addItem);

  const removeItem = useCartStore((state) => state.removeItem);

  const [quantities, setQuantities] = useState<
    Record<UUID, string>
  >({});
  const [selectedCatalogueKey, setSelectedCatalogueKey] =
    useState<string | null>(null);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const isBillingLocked = Boolean(
    bootstrap && !bootstrap.prices_set,
  );

  const orderedItems = useMemo(() => {
    const items = bootstrap?.items;
    if (!Array.isArray(items)) return [];

    return [...items].sort((a, b) => {
      const leftSort = a.sort_order ?? Number.MAX_SAFE_INTEGER;
      const rightSort = b.sort_order ?? Number.MAX_SAFE_INTEGER;
      if (leftSort !== rightSort) {
        return leftSort - rightSort;
      }
      return a.item_name.localeCompare(b.item_name);
    });
  }, [bootstrap?.items]);

  const translatedItemNames = useMemo(() => {
    const entries = orderedItems.map(
      (item): [UUID, string] => [
        item.item_id,
        getLocalizedItemName(language, item.item_name, item.item_tamil_name),
      ],
    );

    return new Map<UUID, string>(entries);
  }, [language, orderedItems]);

  const catalogueOptions = useMemo(() => {
    const categories = new Map<string, CatalogueOption>();

    for (const item of orderedItems) {
      const key = getCatalogueKey(item);
      const existing = categories.get(key);

      if (existing) {
        existing.count += 1;
        continue;
      }

      const categoryName = item.category?.trim();

      categories.set(key, {
        key,
        label: categoryName || t("billing.uncategorizedCatalogue"),
        count: 1,
        isUncategorized: key === UNCATEGORIZED_CATALOGUE_KEY,
      });
    }

    return [...categories.values()];
  }, [orderedItems, t]);

  const selectedCatalogueOption =
    catalogueOptions.find(
      (option) => option.key === selectedCatalogueKey,
    ) ?? catalogueOptions[0] ?? null;
  const activeCatalogueKey = selectedCatalogueOption?.key ?? null;

  const visibleItems = useMemo(() => {
    if (!activeCatalogueKey) {
      return [];
    }

    return orderedItems.filter(
      (item) => getCatalogueKey(item) === activeCatalogueKey,
    );
  }, [activeCatalogueKey, orderedItems]);

  useEffect(() => {
    prefetchItemThumbnails(orderedItems);
  }, [orderedItems]);

  useEffect(() => {
    const firstCatalogueKey = catalogueOptions[0]?.key ?? null;

    if (!firstCatalogueKey) {
      if (selectedCatalogueKey !== null) {
        setSelectedCatalogueKey(null);
      }
      setCatalogueOpen(false);
      return;
    }

    if (
      selectedCatalogueKey === null ||
      !catalogueOptions.some((option) => option.key === selectedCatalogueKey)
    ) {
      setSelectedCatalogueKey(firstCatalogueKey);
      setCatalogueOpen(false);
    }
  }, [catalogueOptions, selectedCatalogueKey]);

  const handleQuantityChange = useCallback(
    (itemId: UUID, value: string) => {
      setQuantities((prev) => {
        if (prev[itemId] === value) {
          return prev;
        }

        return {
          ...prev,
          [itemId]: value,
        };
      });
    },
    [],
  );

  const handleAddToCart = useCallback(
    (item: ItemPriceRead, quantity: string) => {
      const rawQuantity = quantity.trim();
      const itemName =
        translatedItemNames.get(item.item_id) ??
        item.item_name;

      if (!item.current_price || money(item.current_price).lessThanOrEqualTo(0)) {
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
        item_tamil_name: item.item_tamil_name,
        base_unit: item.base_unit,
        unit_type: item.unit_type,
        price_per_unit: item.current_price,
        quantity:
          item.base_unit === BaseUnit.UNIT
            ? toQuantityString(rawQuantity, true)
            : rawQuantity,
      };

      addItem(cartLine);

      setQuantities((prev) => ({
        ...prev,
        [item.item_id]: "",
      }));
    },
    [addItem, t, translatedItemNames],
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

  const handleRefreshBilling = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleLogout = useCallback(() => {
    clearSession();
    resetCart();
    clearPrices();
  }, [clearPrices, clearSession, resetCart]);

  const handleOpenInventory = useCallback(() => {
    navigation.navigate("InventoryManagement");
  }, [navigation]);

  const handleOpenExpenses = useCallback(() => {
    navigation.navigate("ShopExpenses");
  }, [navigation]);

  const handleOpenPrinter = useCallback(() => {
    navigation.navigate("PrinterSetup");
  }, [navigation]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <ShopHeaderActions
          onLogout={handleLogout}
          onRefresh={handleRefreshBilling}
          refreshing={loading}
          onInventory={handleOpenInventory}
          onExpenses={handleOpenExpenses}
          onPrinter={handleOpenPrinter}
        />
      ),
    });
  }, [
    handleLogout,
    handleRefreshBilling,
    handleOpenExpenses,
    handleOpenInventory,
    handleOpenPrinter,
    loading,
    navigation,
  ]);

  const handleToggleCatalogue = useCallback(() => {
    setCatalogueOpen((current) => !current);
  }, []);

  const handleSelectCatalogue = useCallback((key: string) => {
    setSelectedCatalogueKey(key);
    setCatalogueOpen(false);
  }, []);

  const renderProduct: ListRenderItem<ItemPriceRead> =
    useCallback(
      ({ item }) => {
        const quantityLabel =
          item.base_unit === BaseUnit.KG
            ? t("common.quantityKg")
            : t("common.quantityUnits");
        const quantityPlaceholder =
          item.base_unit === BaseUnit.KG
            ? t("common.exampleKg")
            : t("common.exampleUnits");

        return (
          <ProductCard
            item={item}
            quantity={quantities[item.item_id] ?? ""}
            itemName={
              translatedItemNames.get(item.item_id) ??
              item.item_name
            }
            priceText={`${
              item.current_price && money(item.current_price).greaterThan(0)
                ? formatCurrency(item.current_price)
                : t("common.pricePending")
            } / ${formatUnit(item.base_unit)}`}
            quantityLabel={quantityLabel}
            quantityPlaceholder={quantityPlaceholder}
            buttonLabel={
              item.current_price && money(item.current_price).greaterThan(0)
                ? t("action.addToCart")
                : t("action.awaitingPrice")
            }
            onChangeQuantity={handleQuantityChange}
            onAddToCart={handleAddToCart}
          />
        );
      },
      [
        quantities,
        translatedItemNames,
        handleQuantityChange,
        handleAddToCart,
        t,
      ],
    );

  const renderCatalogueHeader = useCallback(
    () => {
      if (!selectedCatalogueOption) {
        return null;
      }

      return (
        <CatalogueDropdown
          label={t("billing.catalogueFilter")}
          selectedLabel={selectedCatalogueOption.label}
          itemCountLabel={t("billing.catalogueItemCount", {
            count: selectedCatalogueOption.count,
          })}
          options={catalogueOptions}
          selectedKey={activeCatalogueKey}
          open={catalogueOpen}
          onToggle={handleToggleCatalogue}
          onSelect={handleSelectCatalogue}
        />
      );
    },
    [
      catalogueOpen,
      catalogueOptions,
      handleSelectCatalogue,
      handleToggleCatalogue,
      activeCatalogueKey,
      selectedCatalogueOption,
      t,
    ],
  );

  const renderCartFooter = useCallback(
    () => (
      <View className="pb-4">
        <SectionHeading
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
              itemName={
                translatedItemNames.get(item.item_id) ??
                getLocalizedItemName(language, item.item_name, item.item_tamil_name)
              }
              quantitySummary={`${item.quantity} ${formatUnit(item.base_unit)} x ${formatCurrency(item.price_per_unit)}`}
              totalText={formatCurrency(
                money(item.quantity)
                  .mul(money(item.price_per_unit))
                  .toFixed(2),
              )}
              removeHelpText={t("billing.removeLine")}
              removeButtonLabel={t("action.remove")}
              onRemove={handleRemoveItem}
            />
          ))
        )}

      </View>
    ),
    [cartItems, handleRemoveItem, language, t, translatedItemNames],
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

  if (bootstrap && isBillingLocked) {
    return (
      <Screen>
        <EmptyState
          title={t("billing.waitingAdminPriceSetup")}
          description={`${t(
            "billing.waitingAdminPriceSetupDescription",
            {
              shopName: bootstrap.shop_name,
            },
          )}\n\n${t("billing.lockedDescription")}`}
          actionLabel={t("action.tryAgain")}
          onAction={() => void refresh()}
        />
      </Screen>
    );
  }

  return (
    <View className="flex-1 bg-cream">
      <Screen scroll={false} topInset={false} contentTopPadding={4}>
        <FlatList
          style={{ flex: 1 }}
          data={visibleItems}
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
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={handleRefreshBilling}
              tintColor="#147D52"
              colors={["#147D52"]}
            />
          }
          contentContainerStyle={{
            paddingBottom: 180,
          }}
          ListHeaderComponent={renderCatalogueHeader}
          ListFooterComponent={renderCartFooter}
          ListEmptyComponent={
            <EmptyState
              title={t("billing.noCatalogueItems")}
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
