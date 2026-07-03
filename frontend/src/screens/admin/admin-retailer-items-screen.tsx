import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchCatalogueItemRows } from "@/api/admin";
import { fetchRetailerItemPrices, syncRetailerItemPrices } from "@/api/retailers";
import { toApiError } from "@/api/client";
import type { AdminRetailerItemsScreenProps } from "@/navigation/types";
import type { ShopItemRead, RetailerItemPriceInput, UUID } from "@/types/api";

import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import { getItemThumbnailUri } from "@/utils/item-images";

import { adminRadii } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { useAdminTheme } from "./use-admin-theme";

type DraftRow = {
  item_id: UUID;
  item_name: string;
  image_thumb_path?: string | null;
  image_path?: string | null;
  price_per_unit: string;
  is_active: boolean;
  selected: boolean;
};

export function AdminRetailerItemsScreen({ navigation, route }: AdminRetailerItemsScreenProps) {
  const { retailerId, retailerName } = route.params;
  const { palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catalogue, mapped] = await Promise.all([
        fetchCatalogueItemRows({ active: true, limit: 200 }),
        fetchRetailerItemPrices(retailerId),
      ]);
      const mappedByItem = new Map(mapped.map((row) => [row.item_id, row]));
      const nextRows = catalogue.items.map((item: ShopItemRead) => {
        const existing = mappedByItem.get(item.id);
        return {
          item_id: item.id,
          item_name: item.name,
          image_thumb_path: item.image_thumb_path,
          image_path: item.image_path,
          price_per_unit: existing?.price_per_unit ?? "",
          is_active: existing?.is_active ?? true,
          selected: Boolean(existing),
        };
      });
      setRows(nextRows);
    } catch (error) {
      Alert.alert("Load failed", toApiError(error).message);
    } finally {
      setLoading(false);
    }
  }, [retailerId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const save = useCallback(async () => {
    const payload: RetailerItemPriceInput[] = [];
    for (const row of rows) {
      if (!row.selected) continue;
      const price = row.price_per_unit.trim();
      if (!price || Number(price) <= 0) {
        Alert.alert("Invalid price", `Set a price for ${row.item_name}`);
        return;
      }
      payload.push({
        item_id: row.item_id,
        price_per_unit: price,
        is_active: row.is_active,
      });
    }
    setSaving(true);
    try {
      await syncRetailerItemPrices(retailerId, payload);
      triggerHaptic();
      navigation.goBack();
    } catch (error) {
      Alert.alert("Save failed", toApiError(error).message);
    } finally {
      setSaving(false);
    }
  }, [navigation, retailerId, rows]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["left", "right"]}>
      <StatusBar style="light" />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingBottom: 12,
          borderBottomWidth: 1,
          backgroundColor: palette.shell,
          borderBottomColor: palette.shellBorder,
          paddingTop: Math.max(insets.top - 8, 0),
        }}
      >
        <Pressable onPress={() => navigation.goBack()}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={palette.onShell} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 20, fontWeight: "900", color: palette.onShell }}>
          Items · {retailerName}
        </Text>
      </View>
      {loading ? (
        <ActivityIndicator color={palette.primary} style={{ marginTop: 24 }} />
      ) : (
        <>
          <FlatList
            style={{ flex: 1 }}
            data={rows}
            keyExtractor={(item) => item.item_id}
            contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
            renderItem={({ item }) => (
              <View
                style={{
                  borderRadius: adminRadii.card,
                  borderWidth: 1,
                  borderColor: palette.border,
                  backgroundColor: palette.card,
                  padding: 12,
                  marginBottom: 10,
                }}
              >
                <Pressable
                  onPress={() =>
                    setRows((current) =>
                      current.map((row) =>
                        row.item_id === item.item_id
                          ? { ...row, selected: !row.selected }
                          : row,
                      ),
                    )
                  }
                  style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                >
                  {getItemThumbnailUri(item) ? (
                    <ItemThumbnail
                      uri={getItemThumbnailUri(item)}
                      recyclingKey={item.item_id}
                      size={52}
                      borderRadius={8}
                      backgroundColor={palette.surfaceMuted}
                      icon="food-drumstick-outline"
                      iconColor={palette.textMuted}
                      iconSize={22}
                    />
                  ) : (
                    <View
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderStyle: "dashed",
                        borderColor: palette.border,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: palette.surfaceMuted,
                      }}
                    >
                      <MaterialCommunityIcons
                        name="food-drumstick-outline"
                        size={22}
                        color={palette.textMuted}
                      />
                    </View>
                  )}
                  <Text style={{ flex: 1, color: palette.textPrimary, fontWeight: "700" }}>
                    {item.selected ? "✓ " : ""}
                    {item.item_name}
                  </Text>
                </Pressable>
                {item.selected ? (
                  <TextInput
                    value={item.price_per_unit}
                    onChangeText={(value) =>
                      setRows((current) =>
                        current.map((row) =>
                          row.item_id === item.item_id
                            ? { ...row, price_per_unit: value }
                            : row,
                        ),
                      )
                    }
                    keyboardType="decimal-pad"
                    placeholder="Price per unit"
                    placeholderTextColor={palette.textMuted}
                    style={{
                      marginTop: 8,
                      borderWidth: 1,
                      borderColor: palette.border,
                      borderRadius: adminRadii.control,
                      padding: 10,
                      color: palette.textPrimary,
                      backgroundColor: palette.surfaceMuted,
                    }}
                  />
                ) : null}
              </View>
            )}
          />
          <Pressable
            onPress={() => void save()}
            disabled={saving}
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              bottom: 24,
              borderRadius: adminRadii.card,
              backgroundColor: palette.primary,
              paddingVertical: 14,
              alignItems: "center",
              opacity: saving ? 0.7 : 1,
            }}
          >
            <Text style={{ color: palette.onPrimary, fontWeight: "700" }}>
              {saving ? "Saving..." : "Save item prices"}
            </Text>
          </Pressable>
        </>
      )}
    </SafeAreaView>
  );
}
