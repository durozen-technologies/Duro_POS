import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, View } from "react-native";
import { Input, XStack, YStack } from "tamagui";

import { EmptyState } from "@/components/ui/empty-state";
import { type PurchaserRead, type UUID } from "@/types/api";
import { ShopText as Text } from "@/components/ui/shop-text";

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
    alignItems: "center",
    padding: 16,
  },
  shopSheet: {
    width: "100%",
    maxWidth: 520,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 16,
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
    borderRadius: 12,
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

function purchaserLabel(purchaser: PurchaserRead) {
  const tamil = purchaser.tamil_name?.trim();
  const primary = tamil ? `${purchaser.name} (${tamil})` : purchaser.name;
  if (purchaser.shop_name?.trim()) {
    return `${primary} — ${purchaser.shop_name.trim()}`;
  }
  return primary;
}

export function PurchaserPicker({
  purchasers,
  selectedPurchaserId,
  loading,
  palette,
  onSelectPurchaser,
  label = "Purchaser",
  optionalHint = "Optional — skip if not needed",
}: {
  purchasers: PurchaserRead[];
  selectedPurchaserId: UUID | null;
  loading: boolean;
  palette: any;
  onSelectPurchaser: (purchaserId: UUID | null) => void;
  label?: string;
  optionalHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedPurchaser = useMemo(
    () => purchasers.find((row) => row.id === selectedPurchaserId) ?? null,
    [purchasers, selectedPurchaserId],
  );

  const filteredPurchasers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return purchasers;
    }
    return purchasers.filter(
      (row) =>
        row.name.toLowerCase().includes(normalized) ||
        (row.tamil_name ?? "").toLowerCase().includes(normalized) ||
        (row.shop_name ?? "").toLowerCase().includes(normalized) ||
        (row.phone ?? "").toLowerCase().includes(normalized),
    );
  }, [query, purchasers]);

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
            {loading
              ? "Loading purchasers..."
              : selectedPurchaser
                ? purchaserLabel(selectedPurchaser)
                : "Select Purchaser"}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-down" size={22} color={palette.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View
          style={[
            styles.modalOverlay,
            styles.centeredModalOverlay,
            { backgroundColor: palette.overlay },
          ]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={[styles.shopSheet, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <XStack alignItems="center" justifyContent="space-between" gap={10}>
              <YStack flex={1} minWidth={0}>
                <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>Select Purchaser</Text>
                <Text style={[styles.sheetSubtitle, { color: palette.textMuted }]}>{optionalHint}</Text>
              </YStack>
              <Pressable
                accessibilityRole="button"
                onPress={() => setOpen(false)}
                style={styles.iconButton}
              >
                <MaterialCommunityIcons name="close" size={20} color={palette.textPrimary} />
              </Pressable>
            </XStack>
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Search purchasers"
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
              data={filteredPurchasers}
              keyExtractor={(row) => row.id}
              style={{ maxHeight: 360 }}
              ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
              renderItem={({ item }) => {
                const selected = item.id === selectedPurchaserId;
                return (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      onSelectPurchaser(item.id);
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
                      <Text
                        numberOfLines={1}
                        style={[styles.shopOptionText, { color: palette.textPrimary }]}
                      >
                        {item.name}
                      </Text>
                      {item.shop_name ? (
                        <Text
                          numberOfLines={1}
                          style={[styles.shopOptionTamilText, { color: palette.textSecondary }]}
                        >
                          {item.shop_name}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <EmptyState
                  title="No purchasers found"
                  description="Change the search text or create a purchaser in Admin Inventory."
                />
              }
            />
          </View>
        </View>
      </Modal>
    </>
  );
}
