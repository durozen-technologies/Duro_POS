import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ScrollView as ScrollViewType,
} from "react-native";

import { recordShopRetailerInventoryUsages } from "@/api/inventory";
import { fetchShopRetailers } from "@/api/retailers";
import { toApiError, formatApiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { RetailerPicker } from "@/screens/shop/components/retailer-picker";
import {
  getLocalizedItemName,
  useShopTranslation,
} from "@/hooks/use-shop-translation";
import {
  BaseUnit,
  type InventoryBackdatePolicyRead,
  type InventoryItemStockRead,
  type RetailerInventoryUsageBulkResult,
  type RetailerRead,
  type UUID,
} from "@/types/api";
import { money } from "@/utils/decimal";

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

function formatQuantity(value: string | number, unit?: BaseUnit) {
  const numeric = money(value).toNumber();
  const display =
    unit === BaseUnit.UNIT && Number.isInteger(numeric)
      ? `${numeric}`
      : numeric.toFixed(unit === BaseUnit.UNIT ? 0 : 3).replace(/\.?0+$/, "");
  if (!unit) {
    return display || "0";
  }
  return `${display || "0"} ${unit === BaseUnit.KG ? "kg" : numeric === 1 ? "unit" : "units"}`;
}

function parseQuantityDraft(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return money(0);
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  return money(trimmed);
}

function isWholeDecimalValue(value: ReturnType<typeof money>) {
  return value.equals(value.toDecimalPlaces(0));
}

function itemQuantityKey(itemId: UUID, categoryId?: UUID | null) {
  return categoryId ? `${itemId}:${categoryId}` : itemId;
}

type RetailerStockModalProps = {
  visible: boolean;
  item: InventoryItemStockRead | null;
  backdatePolicy: InventoryBackdatePolicyRead | null;
  onClose: () => void;
  onSaved: (result: RetailerInventoryUsageBulkResult) => void;
};

export function RetailerStockModal({
  visible,
  item,
  backdatePolicy,
  onClose,
  onSaved,
}: RetailerStockModalProps) {
  const { language, t } = useShopTranslation();
  const [retailers, setRetailers] = useState<RetailerRead[]>([]);
  const [retailersLoading, setRetailersLoading] = useState(false);
  const [selectedRetailerId, setSelectedRetailerId] = useState<UUID | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<ScrollViewType>(null);
  const scrollOffsetRef = useRef(0);
  const quantityFieldRef = useRef<View | null>(null);
  const categoryFieldRefs = useRef<Record<UUID, View | null>>({});
  const activeFieldRef = useRef<View | null>(null);
  const keyboardInsetRef = useRef(0);
  const [keyboardInset, setKeyboardInset] = useState(0);

  const resetForm = useCallback(() => {
    setSelectedRetailerId(null);
    setQuantities({});
    setSaving(false);
    setKeyboardInset(0);
    keyboardInsetRef.current = 0;
    scrollOffsetRef.current = 0;
    activeFieldRef.current = null;
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

  const scrollFieldIntoView = useCallback((field: View | null, inset = keyboardInsetRef.current) => {
    if (!field || inset <= 0) {
      return;
    }
    const runScroll = () => {
      field.measureInWindow((_x, y, _width, height) => {
        const keyboardTop = Dimensions.get("window").height - inset;
        const targetBottom = keyboardTop - 40;
        const overlap = y + height - targetBottom;
        if (overlap > 0) {
          scrollRef.current?.scrollTo({
            y: scrollOffsetRef.current + overlap,
            animated: true,
          });
        }
      });
    };
    requestAnimationFrame(runScroll);
    setTimeout(runScroll, Platform.OS === "android" ? 280 : 120);
  }, []);

  const focusField = useCallback(
    (field: View | null) => {
      activeFieldRef.current = field;
      scrollFieldIntoView(field);
      setTimeout(() => scrollFieldIntoView(field), 80);
      setTimeout(() => scrollFieldIntoView(field), Platform.OS === "android" ? 320 : 180);
    },
    [scrollFieldIntoView],
  );

  useEffect(() => {
    if (!visible) {
      setKeyboardInset(0);
      keyboardInsetRef.current = 0;
      return undefined;
    }
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      const inset = event.endCoordinates.height;
      keyboardInsetRef.current = inset;
      setKeyboardInset(inset);
      const activeField = activeFieldRef.current ?? quantityFieldRef.current;
      requestAnimationFrame(() => scrollFieldIntoView(activeField, inset));
      setTimeout(() => scrollFieldIntoView(activeField, inset), Platform.OS === "android" ? 320 : 120);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      keyboardInsetRef.current = 0;
      setKeyboardInset(0);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [scrollFieldIntoView, visible]);

  const linesToSave = useMemo(() => {
    if (!item || !selectedRetailerId) {
      return [];
    }
    const lines: { inventory_item_id: UUID; category_id?: UUID | null; quantity: string }[] = [];
    if (item.category_usage.length > 0) {
      for (const category of item.category_usage) {
        const raw = quantities[itemQuantityKey(item.id, category.category_id)]?.trim() ?? "";
        const parsed = parseQuantityDraft(raw);
        if (parsed && parsed.greaterThan(0)) {
          lines.push({
            inventory_item_id: item.id,
            category_id: category.category_id,
            quantity: parsed.toFixed(3),
          });
        }
      }
    } else {
      const raw = quantities[itemQuantityKey(item.id)]?.trim() ?? "";
      const parsed = parseQuantityDraft(raw);
      if (parsed && parsed.greaterThan(0)) {
        lines.push({
          inventory_item_id: item.id,
          quantity: parsed.toFixed(3),
        });
      }
    }
    return lines;
  }, [item, quantities, selectedRetailerId]);

  const itemName = useMemo(
    () => (item ? getLocalizedItemName(language, item.name, item.tamil_name) : ""),
    [item, language],
  );

  const validationError = useMemo(() => {
    if (!item || !selectedRetailerId) {
      return null;
    }
    if (linesToSave.length === 0) {
      return t("inventory.retailerStockEnterQuantity", { defaultValue: "Enter at least one quantity." });
    }
    let itemTotal = money(0);
    if (item.category_usage.length > 0) {
      for (const category of item.category_usage) {
        const raw = quantities[itemQuantityKey(item.id, category.category_id)]?.trim() ?? "";
        if (!raw) {
          continue;
        }
        const parsed = parseQuantityDraft(raw);
        if (parsed === null) {
          return t("inventory.invalidQuantityMessage");
        }
        if (item.base_unit === BaseUnit.UNIT && !isWholeDecimalValue(parsed)) {
          return t("billing.alertInvalidUnitQuantityMessage", {
            itemName,
          });
        }
        itemTotal = itemTotal.plus(parsed);
      }
    } else {
      const raw = quantities[itemQuantityKey(item.id)]?.trim() ?? "";
      const parsed = parseQuantityDraft(raw);
      if (parsed === null) {
        return t("inventory.invalidQuantityMessage");
      }
      if (item.base_unit === BaseUnit.UNIT && !isWholeDecimalValue(parsed)) {
        return t("billing.alertInvalidUnitQuantityMessage", {
          itemName,
        });
      }
      itemTotal = itemTotal.plus(parsed);
    }
    if (itemTotal.greaterThan(money(item.available_quantity))) {
      return t("inventory.retailerStockExceedsAvailable", {
        defaultValue: `${item.name} exceeds available stock.`,
        itemName: item.name,
      });
    }
    return null;
  }, [item, itemName, linesToSave.length, quantities, selectedRetailerId, t]);

  const canSave = Boolean(selectedRetailerId && linesToSave.length > 0 && !validationError);

  const handleSave = useCallback(async () => {
    if (!item || !selectedRetailerId || !canSave) {
      return;
    }
    setSaving(true);
    try {
      const result = await recordShopRetailerInventoryUsages({
        retailer_id: selectedRetailerId,
        lines: linesToSave,
        occurred_at: backdatePolicy?.allow_shop_backdated_inventory ? undefined : undefined,
      });
      onSaved(result);
      handleClose();
      Alert.alert(
        t("inventory.retailerStockSavedTitle", { defaultValue: "Retailer stock saved" }),
        t("inventory.retailerStockSavedMessage", { defaultValue: "Usage recorded for the selected retailer." }),
      );
    } catch (error) {
      Alert.alert(t("inventory.saveFailedTitle"), formatApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [backdatePolicy, canSave, handleClose, item, linesToSave, onSaved, selectedRetailerId, t]);

  if (!item) {
    return null;
  }

  const hasCategories = item.category_usage.length > 0;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
      >
        <View className="flex-1 bg-black/45">
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(event) => {
              scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
            }}
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: keyboardInset > 0 ? "flex-start" : "center",
              paddingHorizontal: 16,
              paddingTop: 24,
              paddingBottom: keyboardInset > 0 ? keyboardInset + 48 : 24,
            }}
          >
            <View
              className="w-full self-center rounded-2xl border border-border bg-card p-4"
              style={{ maxWidth: 460 }}
            >
              <View className="gap-5">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-lg font-bold text-ink">
                      {t("inventory.retailerStock", { defaultValue: "Retailer Stock" })}
                    </Text>
                    <Text className="mt-1 text-sm font-semibold text-muted" numberOfLines={2}>
                      {itemName}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleClose}
                    className="h-10 w-10 items-center justify-center"
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                  >
                    <MaterialCommunityIcons name="close" size={22} color="#1E2B22" />
                  </Pressable>
                </View>

                <RetailerPicker
                  retailers={retailers}
                  selectedRetailerId={selectedRetailerId}
                  loading={retailersLoading}
                  palette={PICKER_PALETTE}
                  onSelectRetailer={setSelectedRetailerId}
                  label={t("inventory.retailerLabel", { defaultValue: "Retailer" })}
                />

                <View className="items-center rounded-card border border-accent bg-accentSoft px-4 py-3">
                  <Text className="text-[11px] font-semibold uppercase tracking-[1px] text-muted">
                    {t("inventory.available")}
                  </Text>
                  <Text className="mt-1 text-3xl font-bold text-ink" style={{ fontVariant: ["tabular-nums"] }}>
                    {formatQuantity(item.available_quantity, item.base_unit)}
                  </Text>
                  <Text className="mt-2 text-xs font-semibold text-muted">
                    {t("inventory.retailerUsed", { defaultValue: "Retailer used" })}{" "}
                    {formatQuantity(item.retailer_used_quantity ?? "0", item.base_unit)}
                  </Text>
                </View>

                {selectedRetailerId ? (
                  hasCategories ? (
                    <View className="gap-2">
                      <View className="flex-row items-center justify-between gap-3">
                        <Text className="text-[11px] font-semibold uppercase text-muted">
                          {t("inventory.category")}
                        </Text>
                        <Text className="text-[11px] font-semibold uppercase text-muted">
                          {t("inventory.quantity", { defaultValue: "Quantity" })}
                        </Text>
                      </View>
                      {item.category_usage.map((category) => (
                        <View
                          key={category.category_id}
                          ref={(node) => {
                            categoryFieldRefs.current[category.category_id] = node;
                          }}
                          className="min-h-[62px] flex-row items-center gap-3 rounded-control border border-border bg-surface px-3 py-2"
                        >
                          <View className="min-w-0 flex-1">
                            <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
                              {category.category_name}
                            </Text>
                            <Text className="mt-0.5 text-xs font-semibold text-muted">
                              {t("inventory.used")} {formatQuantity(category.used_quantity, item.base_unit)}
                            </Text>
                          </View>
                          <View className="h-14 w-40 flex-row items-center rounded-control border border-border bg-card px-3">
                            <TextInput
                              keyboardType="decimal-pad"
                              placeholder={item.base_unit === BaseUnit.KG ? "0" : "0"}
                              placeholderTextColor="#95A293"
                              value={quantities[itemQuantityKey(item.id, category.category_id)] ?? ""}
                              onChangeText={(next) =>
                                setQuantities((current) => ({
                                  ...current,
                                  [itemQuantityKey(item.id, category.category_id)]: next,
                                }))
                              }
                              onFocus={() => focusField(categoryFieldRefs.current[category.category_id])}
                              selectTextOnFocus={false}
                              autoCorrect={false}
                              underlineColorAndroid="transparent"
                              selectionColor="#244734"
                              cursorColor="#244734"
                              className="min-w-0 flex-1 text-center text-xl font-bold text-ink"
                            />
                            <Text className="ml-2 text-xs font-semibold uppercase text-muted">{item.base_unit}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View
                      ref={(node) => {
                        quantityFieldRef.current = node;
                      }}
                    >
                      <View className="h-14 flex-row items-center rounded-control border border-border bg-surface px-3">
                        <TextInput
                          keyboardType="decimal-pad"
                          placeholder={t("inventory.quantity", { defaultValue: "Quantity" })}
                          placeholderTextColor="#95A293"
                          value={quantities[itemQuantityKey(item.id)] ?? ""}
                          onChangeText={(next) =>
                            setQuantities((current) => ({
                              ...current,
                              [itemQuantityKey(item.id)]: next,
                            }))
                          }
                          onFocus={() => focusField(quantityFieldRef.current)}
                          selectTextOnFocus={false}
                          autoCorrect={false}
                          underlineColorAndroid="transparent"
                          selectionColor="#244734"
                          cursorColor="#244734"
                          className="min-w-0 flex-1 text-center text-2xl font-bold text-ink"
                        />
                        <Text className="ml-2 text-xs font-semibold uppercase text-muted">{item.base_unit}</Text>
                      </View>
                    </View>
                  )
                ) : (
                  <Text className="text-center text-sm font-semibold text-muted">
                    {t("inventory.retailerStockPickDescription", {
                      defaultValue: "Choose a retailer to record stock usage.",
                    })}
                  </Text>
                )}

                {validationError && selectedRetailerId && linesToSave.length > 0 ? (
                  <Text className="text-center text-xs font-semibold text-[#9F4335]">{validationError}</Text>
                ) : null}

                <View className="flex-row gap-2 pt-1">
                  <Button label={t("action.cancel")} onPress={handleClose} variant="secondary" className="flex-1" />
                  <Button
                    label={saving ? t("inventory.saving") : t("inventory.save")}
                    onPress={() => void handleSave()}
                    loading={saving}
                    disabled={!canSave || saving}
                    className="flex-1"
                  />
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
