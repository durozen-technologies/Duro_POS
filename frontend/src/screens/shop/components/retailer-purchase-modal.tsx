import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { createShopRetailerInventoryPurchase } from "@/api/retailer-inventory";
import { fetchShopRetailers } from "@/api/retailers";
import { fetchShopRetailerWallet } from "@/api/retailer-sales";
import { formatApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { RetailerPicker } from "@/screens/shop/components/retailer-picker";
import {
  getLocalizedItemName,
  useShopTranslation,
} from "@/hooks/use-shop-translation";
import {
  BaseUnit,
  type InventoryItemStockRead,
  type RetailerInventoryPurchaseRead,
  type RetailerRead,
  type UUID,
} from "@/types/api";
import { money } from "@/utils/decimal";
import { formatCurrency } from "@/utils/format";

const PICKER_PALETTE = {
  border: "#D8CCB6",
  card: "#FFFFFF",
  textMuted: "#7A857E",
  textPrimary: "#111811",
  textSecondary: "#303A33",
  overlay: "rgba(0, 0, 0, 0.4)",
  items: "#0F7642",
  itemsSoft: "#E8F3EB",
  itemsStrong: "#0F7642",
  surfaceMuted: "#F7F5F0",
};

type RetailerPurchaseModalProps = {
  visible: boolean;
  items: InventoryItemStockRead[];
  onClose: () => void;
  onSaved: (purchase: RetailerInventoryPurchaseRead) => void;
};

function parsePositiveDraft(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const parsed = money(trimmed);
  return parsed.greaterThan(0) ? parsed : null;
}

export function RetailerPurchaseModal({
  visible,
  items,
  onClose,
  onSaved,
}: RetailerPurchaseModalProps) {
  const { language, t } = useShopTranslation();
  const [retailers, setRetailers] = useState<RetailerRead[]>([]);
  const [retailersLoading, setRetailersLoading] = useState(false);
  const [selectedRetailerId, setSelectedRetailerId] = useState<UUID | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<UUID | null>(null);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [pricePerUnit, setPricePerUnit] = useState("");
  const [creditBalance, setCreditBalance] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  const quantityValue = useMemo(() => parsePositiveDraft(quantity), [quantity]);
  const priceValue = useMemo(() => parsePositiveDraft(pricePerUnit), [pricePerUnit]);
  const lineTotal = useMemo(() => {
    if (!quantityValue || !priceValue) {
      return null;
    }
    return quantityValue.times(priceValue);
  }, [priceValue, quantityValue]);

  const resetForm = useCallback(() => {
    setSelectedRetailerId(null);
    setSelectedItemId(null);
    setItemPickerOpen(false);
    setQuantity("");
    setPricePerUnit("");
    setCreditBalance(null);
    setSaving(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  useEffect(() => {
    if (!visible) {
      resetForm();
      return;
    }
    let cancelled = false;
    setRetailersLoading(true);
    void fetchShopRetailers()
      .then((loaded) => {
        if (!cancelled) {
          setRetailers(loaded);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          Alert.alert(t("inventory.loadFailed"), formatApiErrorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRetailersLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resetForm, t, visible]);

  useEffect(() => {
    if (!visible || !selectedRetailerId) {
      setCreditBalance(null);
      return;
    }
    let cancelled = false;
    setWalletLoading(true);
    void fetchShopRetailerWallet(selectedRetailerId)
      .then((wallet) => {
        if (!cancelled) {
          setCreditBalance(wallet.credit_balance);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCreditBalance(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWalletLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRetailerId, visible]);

  async function handleSave() {
    if (!selectedRetailerId) {
      Alert.alert(t("inventory.retailerPurchaseSelectRetailer"));
      return;
    }
    if (!selectedItem) {
      Alert.alert(t("inventory.retailerPurchaseSelectItem"));
      return;
    }
    if (!quantityValue || !priceValue || !lineTotal) {
      Alert.alert(t("inventory.invalidQuantityTitle"), t("inventory.retailerPurchaseInvalidLine"));
      return;
    }
    if (selectedItem.base_unit === BaseUnit.UNIT && !quantityValue.modulo(1).equals(0)) {
      Alert.alert(t("inventory.invalidQuantityTitle"), t("inventory.retailerPurchaseWholeUnits"));
      return;
    }
    setSaving(true);
    try {
      const purchase = await createShopRetailerInventoryPurchase({
        retailer_id: selectedRetailerId,
        lines: [
          {
            inventory_item_id: selectedItem.id,
            quantity: quantityValue.toFixed(selectedItem.base_unit === BaseUnit.UNIT ? 0 : 3),
            price_per_unit: priceValue.toFixed(2),
          },
        ],
      });
      Alert.alert(
        t("inventory.retailerPurchaseSavedTitle"),
        t("inventory.retailerPurchaseSavedMessage", {
          applied: formatCurrency(purchase.amount_applied_to_outstanding),
          deposited: formatCurrency(purchase.amount_deposited_to_wallet),
        }),
      );
      onSaved(purchase);
      handleClose();
    } catch (error) {
      Alert.alert(t("inventory.saveFailedTitle"), formatApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: PICKER_PALETTE.overlay }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View
            className="max-h-[92%] rounded-t-3xl border border-border bg-card px-4 pb-6 pt-4"
            style={{ borderColor: PICKER_PALETTE.border }}
          >
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-lg font-extrabold text-ink">
                {t("inventory.retailerPurchaseTitle")}
              </Text>
              <Pressable onPress={handleClose} accessibilityRole="button">
                <MaterialCommunityIcons name="close" size={24} color={PICKER_PALETTE.textPrimary} />
              </Pressable>
            </View>

            <ScrollView className="max-h-[70vh]" keyboardShouldPersistTaps="handled">
              <View className="gap-4">
                <RetailerPicker
                  retailers={retailers}
                  loading={retailersLoading}
                  selectedRetailerId={selectedRetailerId}
                  onSelectRetailer={setSelectedRetailerId}
                  palette={PICKER_PALETTE}
                  label={t("inventory.retailerLabel", { defaultValue: "Retailer" })}
                />

                {selectedRetailerId ? (
                  <View className="rounded-card border border-border bg-surface px-3 py-3">
                    <Text className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {t("inventory.retailerPurchaseWalletBalance")}
                    </Text>
                    <Text className="mt-1 text-base font-extrabold text-ink">
                      {walletLoading
                        ? "…"
                        : formatCurrency(creditBalance ?? "0")}
                    </Text>
                  </View>
                ) : null}

                <View className="gap-2">
                  <Text className="text-sm font-semibold text-ink">
                    {t("inventory.retailerPurchaseItem")}
                  </Text>
                  <Pressable
                    onPress={() => setItemPickerOpen((current) => !current)}
                    className="min-h-12 flex-row items-center justify-between rounded-control border border-border bg-card px-3"
                  >
                    <Text className="flex-1 text-sm font-semibold text-ink" numberOfLines={1}>
                      {selectedItem
                        ? getLocalizedItemName(language, selectedItem.name, selectedItem.tamil_name)
                        : t("inventory.retailerPurchaseSelectItem")}
                    </Text>
                    <MaterialCommunityIcons
                      name={itemPickerOpen ? "chevron-up" : "chevron-down"}
                      size={20}
                      color={PICKER_PALETTE.textMuted}
                    />
                  </Pressable>
                  {itemPickerOpen ? (
                    <View className="max-h-44 overflow-hidden rounded-control border border-border">
                      <ScrollView nestedScrollEnabled>
                        {items.map((item) => {
                          const active = item.id === selectedItemId;
                          return (
                            <Pressable
                              key={item.id}
                              onPress={() => {
                                setSelectedItemId(item.id);
                                setItemPickerOpen(false);
                              }}
                              className={`border-b border-border px-3 py-3 ${active ? "bg-accentSoft" : "bg-card"}`}
                            >
                              <Text className="text-sm font-semibold text-ink">
                                {getLocalizedItemName(language, item.name, item.tamil_name)}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    </View>
                  ) : null}
                </View>

                <TextField
                  label={
                    selectedItem?.base_unit === BaseUnit.KG
                      ? t("common.quantityKg")
                      : t("common.quantityUnits")
                  }
                  keyboardType="decimal-pad"
                  value={quantity}
                  onChangeText={setQuantity}
                  placeholder={
                    selectedItem?.base_unit === BaseUnit.KG
                      ? t("common.exampleKg")
                      : t("common.exampleUnits")
                  }
                />

                <TextField
                  label={t("inventory.retailerPurchasePricePerUnit")}
                  keyboardType="decimal-pad"
                  value={pricePerUnit}
                  onChangeText={setPricePerUnit}
                  placeholder="0.00"
                />

                {lineTotal ? (
                  <View className="items-center rounded-card border border-accent bg-accentSoft px-4 py-3">
                    <Text className="text-[11px] font-semibold uppercase tracking-[1px] text-muted">
                      {t("inventory.retailerPurchaseLineTotal")}
                    </Text>
                    <Text className="mt-1 text-2xl font-bold text-ink">
                      {formatCurrency(lineTotal.toFixed(2))}
                    </Text>
                  </View>
                ) : null}
              </View>
            </ScrollView>

            <View className="mt-4 gap-2">
              <Button
                label={saving ? t("inventory.saving") : t("inventory.retailerPurchaseSubmit")}
                onPress={() => void handleSave()}
                disabled={saving}
              />
              <Button label={t("action.cancel")} variant="secondary" onPress={handleClose} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
