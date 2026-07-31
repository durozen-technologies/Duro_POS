import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import DraggableFlatList, { type RenderItemParams } from "react-native-draggable-flatlist";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchShopRetailers, updateShopRetailersOrder } from "@/api/retailers";
import { formatApiErrorMessage } from "@/api/client";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { ShopText as Text } from "@/components/ui/shop-text";
import { appTheme } from "@/constants/theme";
import { useShopTranslation } from "@/hooks/use-shop-translation";
import type { ShopRetailersOrderScreenProps } from "@/navigation/types";
import type { RetailerRead } from "@/types/api";

function OrderRow({ item, drag, isActive }: RenderItemParams<RetailerRead>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Arrange ${item.name}`}
      onLongPress={drag}
      delayLongPress={120}
      disabled={isActive}
      className={`mb-2 min-h-[72px] flex-row items-center gap-3 rounded-card border px-3 py-2.5 ${
        isActive ? "border-accent bg-accent/10" : "border-border bg-card"
      }`}
    >
      <View className="h-10 w-10 items-center justify-center rounded-control bg-surface">
        <MaterialCommunityIcons name="storefront-outline" size={20} color={appTheme.accentDeep} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] font-bold text-ink" numberOfLines={1}>
          {item.name}
        </Text>
        {item.shop_name ? (
          <Text className="mt-0.5 text-sm font-medium text-muted" numberOfLines={1}>
            {item.shop_name}
          </Text>
        ) : null}
      </View>
      <MaterialCommunityIcons name="drag-horizontal-variant" size={22} color={appTheme.muted} />
    </Pressable>
  );
}

export function ShopRetailersOrderScreen({ navigation }: ShopRetailersOrderScreenProps) {
  const { t } = useShopTranslation();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<RetailerRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const loaded = await fetchShopRetailers();
      setItems(loaded);
    } catch (error) {
      setErrorMessage(formatApiErrorMessage(error, t("retailers.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const persistOrder = useCallback(
    async (nextItems: RetailerRead[]) => {
      if (nextItems.length === 0) {
        return;
      }
      setSaving(true);
      setErrorMessage(null);
      try {
        await updateShopRetailersOrder({
          retailer_ids: nextItems.map((item) => item.id),
        });
      } catch (error) {
        setErrorMessage(formatApiErrorMessage(error, t("retailers.rearrangeSaveFailed")));
        await loadItems();
      } finally {
        setSaving(false);
      }
    },
    [loadItems, t],
  );

  const renderItem = useCallback(
    (params: RenderItemParams<RetailerRead>) => <OrderRow {...params} />,
    [],
  );

  return (
    <View className="flex-1 bg-cream">
      <Screen scroll={false} topInset={false} contentTopPadding={4}>
        <View className="mb-3 flex-row items-center justify-between gap-2">
          <Text className="flex-1 text-sm font-semibold text-muted">
            {saving ? t("retailers.rearrangeSaving") : t("retailers.rearrangeHint")}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={() => navigation.goBack()}
            className="min-h-[40px] items-center justify-center rounded-control bg-accent px-3 active:opacity-90"
          >
            <Text className="text-sm font-bold text-white">Done</Text>
          </Pressable>
        </View>

        {errorMessage ? (
          <View className="mb-3 flex-row items-center gap-2 rounded-card border border-amber-700/30 bg-amber-50 px-3 py-2.5">
            <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#92400E" />
            <Text className="flex-1 text-sm font-semibold text-amber-900">{errorMessage}</Text>
          </View>
        ) : null}

        {loading && items.length === 0 ? (
          <View className="flex-1 items-center justify-center gap-3">
            <ActivityIndicator color={appTheme.accent} />
            <Text className="text-sm font-semibold text-muted">{t("retailers.loading")}</Text>
          </View>
        ) : (
          <DraggableFlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            onDragEnd={({ data }) => {
              setItems(data);
              void persistOrder(data);
            }}
            activationDistance={8}
            containerStyle={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
            ListEmptyComponent={
              <EmptyState title={t("retailers.rearrangeEmpty")} description={t("retailers.empty")} />
            }
          />
        )}
      </Screen>
    </View>
  );
}
