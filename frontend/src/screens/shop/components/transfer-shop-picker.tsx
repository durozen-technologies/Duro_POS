import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Input, XStack, YStack } from "tamagui";

import { EmptyState } from "@/components/ui/empty-state";
import { type TransferShopRead, type UUID } from "@/types/api";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

const styles = StyleSheet.create({
  shopPicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  shopPickerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  shopName: {
    fontSize: 15,
    fontWeight: "600",
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  centeredModalOverlay: {
    justifyContent: "center",
    padding: 16,
  },
  shopSheet: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  sheetSubtitle: {
    fontSize: 13,
    fontWeight: "500",
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  shopOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  shopOptionText: {
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  shopOptionTamilText: {
    fontSize: 12,
    fontWeight: "500",
  },
});

export function TransferShopPicker({
  shops,
  selectedShopId,
  loading,
  palette,
  onSelectShop,
  label = "Destination Shop",
}: {
  shops: TransferShopRead[];
  selectedShopId: UUID | null;
  loading: boolean;
  palette: any;
  onSelectShop: (shopId: UUID) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  
  const selectedShop = useMemo(() => shops.find((s) => s.id === selectedShopId) ?? null, [shops, selectedShopId]);

  const filteredShops = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return shops;
    }
    return shops.filter((shop) => shop.name.toLowerCase().includes(normalized) || shop.tamil_name.toLowerCase().includes(normalized));
  }, [query, shops]);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={[styles.shopPicker, { borderColor: palette.border, backgroundColor: palette.card }]}
      >
        <View style={styles.shopPickerText}>
          <Text style={[styles.eyebrow, { color: palette.textMuted }]}>{label}</Text>
          <Text numberOfLines={1} style={[styles.shopName, { color: palette.textPrimary }]}>
            {loading ? "Loading shops..." : selectedShop?.name ?? "Select a transfer shop"}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-down" size={22} color={palette.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={[styles.modalOverlay, styles.centeredModalOverlay, { backgroundColor: palette.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={[styles.shopSheet, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <XStack alignItems="center" justifyContent="space-between" gap={10}>
              <YStack flex={1} minWidth={0}>
                <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>Select transfer shop</Text>
                <Text style={[styles.sheetSubtitle, { color: palette.textMuted }]}>
                  Choose the destination for this stock transfer.
                </Text>
              </YStack>
              <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.iconButton}>
                <MaterialCommunityIcons name="close" size={20} color={palette.textPrimary} />
              </Pressable>
            </XStack>
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Search shops"
              placeholderTextColor={palette.textMuted as never}
              minHeight={44}
              borderRadius={10}
              borderWidth={1}
              borderColor={palette.border}
              backgroundColor={palette.surfaceMuted}
              color={palette.textPrimary}
              fontSize={14}
              fontWeight="700"
            />
            <FlatList
              data={filteredShops}
              keyExtractor={(shop) => shop.id}
              style={{ maxHeight: 360 }}
              ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
              renderItem={({ item }) => {
                const selected = item.id === selectedShopId;
                return (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      onSelectShop(item.id);
                      setOpen(false);
                    }}
                    style={[
                      styles.shopOption,
                      {
                        borderColor: selected ? palette.items : palette.border,
                        backgroundColor: selected ? palette.itemsSoft : palette.surfaceMuted,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={selected ? "radiobox-marked" : "radiobox-blank"}
                      size={18}
                      color={selected ? palette.itemsStrong : palette.textSecondary}
                    />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={[styles.shopOptionText, { color: palette.textPrimary }]}>
                        {item.name}
                      </Text>
                      <Text numberOfLines={1} style={[styles.shopOptionTamilText, { color: palette.textSecondary }]}>
                        {item.tamil_name}
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <EmptyState
                  title="No shops found"
                  description="Change the search text or create a transfer shop first."
                />
              }
            />
          </View>
        </View>
      </Modal>
    </>
  );
}
