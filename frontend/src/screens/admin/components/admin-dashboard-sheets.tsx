import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Controller } from "react-hook-form";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { WebView } from "react-native-webview";

import { buildReceiptHtml } from "@/api/receipts";
import { useReceiptImagePrintJob } from "@/hooks/use-receipt-image-print-job";
import { usePrinterStore } from "@/store/printer-store";
import type { BillRead, ShopBootstrapResponse, ShopRead, UUID } from "@/types/api";
import { formatCurrency, formatDateTime } from "@/utils/format";

import { adminShadow, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import { EmptyStateCard, PrimaryButton } from "./admin-dashboard-primitives";

type PriceUpdateSheetProps = {
  visible: boolean;
  onClose: () => void;
  palette: ThemePalette;
  bottomInset: number;
  priceLoading: boolean;
  priceBootstrap: ShopBootstrapResponse | null;
  currentPriceItem:
  | (ShopBootstrapResponse["items"][number] & {
    current_price?: string | null;
  })
  | null;
  selectedPriceItemId: UUID | null;
  resolveItemPrice: (itemId: UUID, currentPrice?: string | null) => string;
  onSelectItem: (itemId: UUID, currentPrice?: string | null) => void;
  draftPrice: string;
  onChangeDraftPrice: (value: string) => void;
  priceError: string | null;
  priceHelperText: string | null;
  saveDisabled: boolean;
  itemPickerOpen: boolean;
  onToggleItemPicker: () => void;
  savingPrice: boolean;
  onSave: () => void;
  shops: ShopRead[];
  selectedPriceShopId: UUID | null;
  onSelectShop: (shopId: UUID) => void;
  shopPickerOpen: boolean;
  onToggleShopPicker: () => void;
};

type ShopEditorSheetProps = {
  visible: boolean;
  onClose: () => void;
  palette: ThemePalette;
  bottomInset: number;
  mode: "create" | "edit";
  loading: boolean;
  deleting?: boolean;
  statusLoading?: boolean;
  isActive?: boolean;
  control: any;
  onSubmit: () => void;
  onDelete?: () => void;
  onToggleActive?: () => void;
};

type BillPreviewSheetProps = {
  visible: boolean;
  onClose: () => void;
  palette: ThemePalette;
  bottomInset: number;
  loading: boolean;
  bill: BillRead | null;
};

const RECEIPT_PREVIEW_CANVAS_WIDTH = 404;

function useSwipeToClose(onClose: () => void) {
  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 8,
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dy > 0) {
            translateY.setValue(gestureState.dy);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 100 || gestureState.vy > 0.9) {
            Animated.timing(translateY, {
              toValue: 420,
              duration: 180,
              useNativeDriver: true,
            }).start(() => {
              translateY.setValue(0);
              onClose();
            });
            return;
          }

          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [onClose, translateY],
  );

  return { panResponder, translateY };
}

export function PriceUpdateSheet({
  visible,
  onClose,
  palette,
  bottomInset,
  priceLoading,
  priceBootstrap,
  currentPriceItem,
  selectedPriceItemId,
  resolveItemPrice,
  onSelectItem,
  draftPrice,
  onChangeDraftPrice,
  priceError,
  priceHelperText,
  saveDisabled,
  itemPickerOpen,
  onToggleItemPicker,
  savingPrice,
  onSave,
  shops,
  selectedPriceShopId,
  onSelectShop,
  shopPickerOpen,
  onToggleShopPicker,
}: PriceUpdateSheetProps) {
  const { panResponder, translateY } = useSwipeToClose(onClose);

  const summaryText =
    currentPriceItem && draftPrice
      ? `${currentPriceItem.item_name} will update from ${currentPriceItem.current_price ? formatCurrency(currentPriceItem.current_price) : "not set"
      } to Rs. ${draftPrice}.`
      : "Select an item and enter a valid price to preview the update summary.";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, { backgroundColor: palette.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Animated.View
            {...panResponder.panHandlers}
            style={[
              styles.bottomSheet,
              styles.expansiveBottomSheet,
              adminShadow(palette.shadow, 0.16, 18, 24),
              {
                backgroundColor: palette.card,
                borderColor: palette.border,
                paddingBottom: bottomInset + 16,
                transform: [{ translateY }],
              },
            ]}
          >
            <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
            <View style={styles.sheetHeader}>
              <View style={styles.headerTextWrap}>
                <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>Update Price</Text>
                <Text style={[styles.sheetSubtitle, { color: palette.textMuted }]}>
                  Select a shop, then set prices for each item.
                </Text>
              </View>
              <View style={styles.headerActions}>
                {!priceLoading && selectedPriceShopId && priceBootstrap && currentPriceItem ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save price update"
                    accessibilityState={{ disabled: savingPrice || saveDisabled }}
                    disabled={savingPrice || saveDisabled}
                    onPress={onSave}
                    style={[
                      styles.headerSaveButton,
                      {
                        backgroundColor: palette.emerald,
                        borderColor: palette.emerald,
                        opacity: savingPrice || saveDisabled ? 0.56 : 1,
                      },
                    ]}
                  >
                    {savingPrice ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <MaterialCommunityIcons name="content-save-outline" size={16} color="#FFFFFF" />
                        <Text style={styles.headerSaveButtonText}>Save</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close update price sheet"
                  onPress={onClose}
                  style={[styles.iconButton, { backgroundColor: palette.backgroundElevated, borderColor: palette.border }]}
                >
                  <MaterialCommunityIcons name="close" size={18} color={palette.textPrimary} />
                </Pressable>
              </View>
            </View>

            {priceLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={palette.emerald} />
                <Text style={[styles.loadingText, { color: palette.textSecondary }]}>Loading prices for shop...</Text>
              </View>
            ) : (
              <>
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.sheetContent}
                >
                  {/* ── Step 1: Shop Selector ── */}
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>Shop</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Choose shop to update prices for"
                      onPress={() => {
                        triggerHaptic();
                        onToggleShopPicker();
                      }}
                      style={[styles.sheetField, { backgroundColor: palette.backgroundElevated, borderColor: selectedPriceShopId ? palette.emerald : palette.border }]}
                    >
                      <Text style={[styles.sheetFieldValue, { color: selectedPriceShopId ? palette.textPrimary : palette.textMuted }]}>
                        {selectedPriceShopId
                          ? shops.find((s) => s.id === selectedPriceShopId)?.name ?? "Selected Shop"
                          : "Select a shop to configure prices"}
                      </Text>
                      <MaterialCommunityIcons
                        name={shopPickerOpen ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={selectedPriceShopId ? palette.emerald : palette.textMuted}
                      />
                    </Pressable>
                    {shopPickerOpen ? (
                      <View style={[styles.optionMenu, { backgroundColor: palette.backgroundElevated, borderColor: palette.border }]}>
                        {shops.map((shop) => (
                          <Pressable
                            key={shop.id}
                            onPress={() => onSelectShop(shop.id)}
                            style={[
                              styles.optionItem,
                              shop.id === selectedPriceShopId && { backgroundColor: palette.emeraldSoft },
                            ]}
                          >
                            <Text style={[styles.optionTitle, { color: palette.textPrimary }]}>{shop.name}</Text>
                            <Text style={[styles.optionSubtitle, { color: palette.textMuted }]}>
                              {shop.username} · {shop.is_active ? "Active" : "Paused"}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>

                  {/* ── Step 2: Item prices (only after shop selected) ── */}
                  {!selectedPriceShopId ? null : priceBootstrap && currentPriceItem ? (
                    <>
                      <View style={styles.fieldGroup}>
                        <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>Item</Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Choose item to update"
                          onPress={() => {
                            triggerHaptic();
                            onToggleItemPicker();
                          }}
                          style={[styles.sheetField, { backgroundColor: palette.backgroundElevated, borderColor: palette.border }]}
                        >
                          <Text style={[styles.sheetFieldValue, { color: palette.textPrimary }]}>{currentPriceItem.item_name}</Text>
                          <MaterialCommunityIcons
                            name={itemPickerOpen ? "chevron-up" : "chevron-down"}
                            size={18}
                            color={palette.textMuted}
                          />
                        </Pressable>
                        {itemPickerOpen ? (
                          <View style={[styles.optionMenu, { backgroundColor: palette.backgroundElevated, borderColor: palette.border }]}>
                            {priceBootstrap.items.map((item) => (
                              <Pressable
                                key={item.item_id}
                                onPress={() => onSelectItem(item.item_id, item.current_price)}
                                style={[
                                  styles.optionItem,
                                  item.item_id === selectedPriceItemId && { backgroundColor: palette.emeraldSoft },
                                ]}
                              >
                                <Text style={[styles.optionTitle, { color: palette.textPrimary }]}>{item.item_name}</Text>
                                <Text style={[styles.optionSubtitle, { color: palette.textMuted }]}>
                                  {resolveItemPrice(item.item_id, item.current_price)
                                    ? `Draft or current: ${formatCurrency(resolveItemPrice(item.item_id, item.current_price))}`
                                    : "No current price"}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        ) : null}
                      </View>

                      <View style={[styles.previewCard, { backgroundColor: palette.emeraldSoft, borderColor: palette.border }]}>
                        <Text style={[styles.previewLabel, { color: palette.emeraldDark }]}>Current Price</Text>
                        <Text style={[styles.previewValue, { color: palette.emeraldDark }]}>
                          {currentPriceItem.current_price ? formatCurrency(currentPriceItem.current_price) : "Not set"}
                        </Text>
                        <Text style={[styles.previewMeta, { color: palette.textSecondary }]}>
                          Unit: {currentPriceItem.base_unit.toUpperCase()}
                        </Text>
                      </View>

                      <View style={styles.fieldGroup}>
                        <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>New Price</Text>
                        <View
                          style={[
                            styles.sheetField,
                            { backgroundColor: palette.backgroundElevated, borderColor: priceError ? palette.danger : palette.border },
                          ]}
                        >
                          <Text style={[styles.currencyPrefix, { color: palette.textMuted }]}>Rs.</Text>
                          <TextInput
                            value={draftPrice}
                            onChangeText={onChangeDraftPrice}
                            keyboardType="decimal-pad"
                            placeholder="Enter updated price"
                            placeholderTextColor={palette.textMuted}
                            style={[styles.sheetInput, { color: palette.textPrimary }]}
                            accessibilityLabel="Enter updated price"
                          />
                        </View>
                        {priceHelperText ? <Text style={[styles.helperText, { color: palette.textSecondary }]}>{priceHelperText}</Text> : null}
                        {priceError ? <Text style={[styles.inlineError, { color: palette.danger }]}>{priceError}</Text> : null}
                      </View>

                      <View style={[styles.summaryCard, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
                        <Text style={[styles.summaryTitle, { color: palette.textPrimary }]}>Save Summary</Text>
                        <Text style={[styles.summaryText, { color: palette.textSecondary }]}>{summaryText}</Text>
                      </View>
                    </>
                  ) : null}
                </ScrollView>

                {selectedPriceShopId && priceBootstrap && currentPriceItem ? (
                  <View style={styles.actionsRow}>
                    <PrimaryButton label="Cancel" onPress={onClose} variant="secondary" palette={palette} />
                    <PrimaryButton
                      label="Save Price Update"
                      onPress={onSave}
                      loading={savingPrice}
                      disabled={saveDisabled}
                      icon="content-save-outline"
                      palette={palette}
                    />
                  </View>
                ) : null}
              </>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export function ShopEditorSheet({
  visible,
  onClose,
  palette,
  bottomInset,
  mode,
  loading,
  deleting = false,
  statusLoading = false,
  isActive = true,
  control,
  onSubmit,
  onDelete,
  onToggleActive,
}: ShopEditorSheetProps) {
  const isEdit = mode === "edit";
  const [passwordVisible, setPasswordVisible] = useState(false);

  useEffect(() => {
    if (!visible) {
      setPasswordVisible(false);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, { backgroundColor: palette.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View
            style={[
              styles.bottomSheet,
              adminShadow(palette.shadow, 0.16, 18, 24),
              {
                backgroundColor: palette.card,
                borderColor: palette.border,
                paddingBottom: bottomInset + 16,
              },
            ]}
          >
            <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
            <View style={styles.sheetHeader}>
              <View style={styles.headerTextWrap}>
                <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>{isEdit ? "Manage Shop" : "Create Shop"}</Text>
                <Text style={[styles.sheetSubtitle, { color: palette.textMuted }]}>
                  {isEdit
                    ? "Update branch details, change the login password, or remove a branch that has no history yet."
                    : "Add a new branch account with shop details and login credentials."}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isEdit ? "Close manage shop sheet" : "Close create shop sheet"}
                onPress={onClose}
                style={[styles.iconButton, { backgroundColor: palette.backgroundElevated, borderColor: palette.border }]}
              >
                <MaterialCommunityIcons name="close" size={18} color={palette.textPrimary} />
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.sheetContent}>
                <Controller
                  control={control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <View style={styles.fieldGroup}>
                      <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>Shop Name</Text>
                      <View
                        style={[
                          styles.sheetField,
                          {
                            backgroundColor: palette.backgroundElevated,
                            borderColor: fieldState.error ? palette.danger : palette.border,
                          },
                        ]}
                      >
                        <TextInput
                          value={field.value}
                          onChangeText={field.onChange}
                          placeholder="Enter branch name"
                          placeholderTextColor={palette.textMuted}
                          style={[styles.sheetInput, { color: palette.textPrimary }]}
                          accessibilityLabel="Enter shop name"
                        />
                      </View>
                      {fieldState.error ? <Text style={[styles.inlineError, { color: palette.danger }]}>{fieldState.error.message}</Text> : null}
                    </View>
                  )}
                />


                <Controller
                  control={control}
                  name="username"
                  render={({ field, fieldState }) => (
                    <View style={styles.fieldGroup}>
                      <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>Login Username</Text>
                      <View
                        style={[
                          styles.sheetField,
                          {
                            backgroundColor: palette.backgroundElevated,
                            borderColor: fieldState.error ? palette.danger : palette.border,
                          },
                        ]}
                      >
                        <TextInput
                          value={field.value}
                          onChangeText={field.onChange}
                          placeholder="Enter login username"
                          autoCapitalize="none"
                          autoCorrect={false}
                          placeholderTextColor={palette.textMuted}
                          style={[styles.sheetInput, { color: palette.textPrimary }]}
                          accessibilityLabel="Enter login username"
                        />
                      </View>
                      {fieldState.error ? <Text style={[styles.inlineError, { color: palette.danger }]}>{fieldState.error.message}</Text> : null}
                    </View>
                  )}
                />

                <Controller
                  control={control}
                  name="password"
                  render={({ field, fieldState }) => (
                    <View style={styles.fieldGroup}>
                      <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>
                        {isEdit ? "Reset Password" : "Login Password"}
                      </Text>
                      <View
                        style={[
                          styles.sheetField,
                          {
                            backgroundColor: palette.backgroundElevated,
                            borderColor: fieldState.error ? palette.danger : palette.border,
                          },
                        ]}
                      >
                        <TextInput
                          value={field.value}
                          onChangeText={field.onChange}
                          placeholder={isEdit ? "Leave blank to keep the current password" : "Enter login password"}
                          autoCapitalize="none"
                          autoCorrect={false}
                          secureTextEntry={!passwordVisible}
                          placeholderTextColor={palette.textMuted}
                          style={[styles.sheetInput, { color: palette.textPrimary }]}
                          accessibilityLabel="Enter login password"
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={passwordVisible ? "Hide password" : "Show password"}
                          onPress={() => setPasswordVisible((current) => !current)}
                          style={styles.inputIconButton}
                        >
                          <MaterialCommunityIcons
                            name={passwordVisible ? "eye-off-outline" : "eye-outline"}
                            size={20}
                            color={palette.textMuted}
                          />
                        </Pressable>
                      </View>
                      {fieldState.error ? <Text style={[styles.inlineError, { color: palette.danger }]}>{fieldState.error.message}</Text> : null}
                    </View>
                  )}
                />

              </View>
            </ScrollView>

            {isEdit ? (
              <View style={styles.editActionsColumn}>
                <PrimaryButton
                  label="Save Changes"
                  onPress={onSubmit}
                  loading={loading}
                  disabled={deleting || statusLoading}
                  icon="content-save-outline"
                  variant="secondary"
                  fullWidth
                  palette={palette}
                  backgroundColorOverride={palette.upiSoft}
                  borderColorOverride={palette.upi}
                  textColorOverride={palette.upi}
                />

                <View style={styles.actionsRow}>
                  {onToggleActive ? (
                    <View style={styles.sheetActionButton}>
                      <PrimaryButton
                        label={isActive ? "Pause Access" : "Activate Shop"}
                        onPress={onToggleActive}
                        loading={statusLoading}
                        disabled={loading || deleting}
                        variant="secondary"
                        icon={isActive ? "pause-circle-outline" : "check-circle-outline"}
                        fullWidth
                        palette={palette}
                        backgroundColorOverride={isActive ? palette.cashSoft : palette.emeraldSoft}
                        borderColorOverride={isActive ? palette.cash : palette.emerald}
                        textColorOverride={isActive ? "#8A5A11" : palette.emeraldDark}
                      />
                    </View>
                  ) : null}
                  {onDelete ? (
                    <View style={styles.sheetActionButton}>
                      <PrimaryButton
                        label="Delete Shop"
                        onPress={onDelete}
                        loading={deleting}
                        disabled={loading || statusLoading}
                        variant="secondary"
                        fullWidth
                        palette={palette}
                        backgroundColorOverride={palette.dangerSoft}
                        borderColorOverride={palette.danger}
                        textColorOverride={palette.danger}
                      />
                    </View>
                  ) : null}
                </View>
              </View>
            ) : (
              <View
                style={[
                  styles.createActionsWrap,
                  {
                    backgroundColor: palette.backgroundElevated,
                    borderColor: palette.border,
                  },
                ]}
              >
                <View style={styles.actionsRow}>
                  <View style={styles.sheetActionButton}>
                    <PrimaryButton
                      label="Cancel"
                      onPress={onClose}
                      variant="secondary"
                      icon="close"
                      fullWidth
                      palette={palette}
                      backgroundColorOverride={palette.dangerSoft}
                      borderColorOverride={palette.danger}
                      textColorOverride={palette.danger}
                    />
                  </View>
                  <View style={styles.sheetActionButton}>
                    <PrimaryButton
                      label="Create Account"
                      onPress={onSubmit}
                      loading={loading}
                      icon="store-plus-outline"
                      variant="secondary"
                      fullWidth
                      palette={palette}
                      backgroundColorOverride={palette.emeraldSoft}
                      borderColorOverride={palette.emerald}
                      textColorOverride={palette.emeraldDark}
                    />
                  </View>
                </View>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export function BillPreviewSheet({
  visible,
  onClose,
  palette,
  bottomInset,
  loading,
  bill,
}: BillPreviewSheetProps) {
  const { panResponder, translateY } = useSwipeToClose(onClose);
  const preferredPrinter = usePrinterStore((state) => state.preferredPrinter);
  const [receiptPreviewHeight, setReceiptPreviewHeight] = useState(320);
  const [printing, setPrinting] = useState(false);
  const receiptHtml = useMemo(() => (bill ? buildReceiptHtml(bill) : ""), [bill]);
  const { receiptImagePrintBridge, startReceiptImagePrintJob } = useReceiptImagePrintJob();

  useEffect(() => {
    setReceiptPreviewHeight(320);
  }, [bill?.id]);

  async function handlePrint() {
    if (!bill) return;

    if (!preferredPrinter) {
      Alert.alert("Printer Not Configured", "Connect a saved printer on this device before printing receipts.");
      return;
    }

    try {
      setPrinting(true);
      await startReceiptImagePrintJob([bill], preferredPrinter);
    } catch (error) {
      Alert.alert("Unable to Print", error instanceof Error ? error.message : "The saved printer could not print this receipt.");
    } finally {
      setPrinting(false);
    }
  }

  const receiptPreviewScript = useMemo(
    () => `
      (function() {
        function postHeight() {
          var receipt = document.querySelector('.receipt-container');
          var receiptHeight = receipt ? receipt.getBoundingClientRect().height : 0;
          var bodyHeight = document.body ? document.body.getBoundingClientRect().height : 0;
          var docHeight = document.documentElement ? document.documentElement.getBoundingClientRect().height : 0;
          var height = Math.ceil(Math.max(receiptHeight, bodyHeight, docHeight));
          window.ReactNativeWebView.postMessage(String(height));
        }

        document.documentElement.style.margin = '0';
        document.documentElement.style.padding = '0';
        document.documentElement.style.overflow = 'hidden';

        if (document.body) {
          document.body.style.margin = '0';
          document.body.style.overflow = 'hidden';
        }

        window.addEventListener('load', postHeight);
        window.addEventListener('resize', postHeight);
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(postHeight);
        }
        setTimeout(postHeight, 60);
        setTimeout(postHeight, 180);
        setTimeout(postHeight, 420);
        setTimeout(postHeight, 900);
      })();
      true;
    `,
    [],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, { backgroundColor: palette.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Animated.View
            {...panResponder.panHandlers}
            style={[
              styles.bottomSheet,
              adminShadow(palette.shadow, 0.16, 18, 24),
              {
                backgroundColor: palette.card,
                borderColor: palette.border,
                paddingBottom: bottomInset + 16,
                transform: [{ translateY }],
              },
            ]}
          >
            <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
            <View style={styles.sheetHeader}>
              <View style={styles.headerTextWrap}>
                <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>Bill Preview</Text>
                <Text style={[styles.sheetSubtitle, { color: palette.textMuted }]}>
                  Review receipt details, purchased items, and payment totals.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close bill preview"
                onPress={onClose}
                style={[styles.iconButton, { backgroundColor: palette.backgroundElevated, borderColor: palette.border }]}
              >
                <MaterialCommunityIcons name="close" size={18} color={palette.textPrimary} />
              </Pressable>
            </View>

            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={palette.emerald} />
                <Text style={[styles.loadingText, { color: palette.textSecondary }]}>Loading bill preview...</Text>
              </View>
            ) : bill ? (
              <>
                <ScrollView
                  style={styles.sheetScroll}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.sheetContent}
                >
                  <View style={styles.receiptPreviewWrap}>
                    <View
                      style={[
                        styles.receiptPreviewFrame,
                        {
                          width: RECEIPT_PREVIEW_CANVAS_WIDTH,
                          maxWidth: "100%",
                          backgroundColor: palette.card,
                          borderColor: palette.border,
                        },
                      ]}
                    >
                      <WebView
                        originWhitelist={["*"]}
                        source={{ html: receiptHtml }}
                        injectedJavaScript={receiptPreviewScript}
                        onMessage={(event) => {
                          const nextHeight = Number(event.nativeEvent.data);
                          if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
                            return;
                          }
                          setReceiptPreviewHeight(nextHeight);
                        }}
                        scrollEnabled={false}
                        nestedScrollEnabled={false}
                        showsVerticalScrollIndicator={false}
                        showsHorizontalScrollIndicator={false}
                        style={{ width: "100%", height: receiptPreviewHeight, backgroundColor: "transparent" }}
                      />
                    </View>
                  </View>
                </ScrollView>

                {/* Print footer */}
                <View
                  style={[
                    styles.printFooter,
                    {
                      backgroundColor: palette.card,
                      borderTopColor: palette.border,
                    },
                  ]}
                >
                  <View style={styles.printFooterActionsRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Print receipt"
                      accessibilityState={{ disabled: printing }}
                      disabled={printing}
                      onPress={() => void handlePrint()}
                      style={({ pressed }) => [
                        styles.footerButton,
                        {
                          backgroundColor: palette.emerald,
                          borderColor: palette.emerald,
                          opacity: printing ? 0.72 : pressed ? 0.94 : 1,
                        },
                      ]}
                    >
                      <View style={styles.footerButtonContent}>
                        <View style={styles.footerButtonIconSlot}>
                          {printing ? (
                            <ActivityIndicator size="small" color={palette.emeraldDark} />
                          ) : (
                            <MaterialCommunityIcons
                              name="printer-outline"
                              size={18}
                              color={palette.emeraldDark}
                            />
                          )}
                        </View>
                        <Text style={[styles.footerButtonPrimaryText, { color: palette.emeraldDark }]}>
                          {printing ? "Opening..." : "Print Receipt"}
                        </Text>
                      </View>
                    </Pressable>
                  </View>
                </View>
              </>
            ) : (
              <EmptyStateCard
                title="Bill preview unavailable"
                subtitle="Open another bill to preview its details."
                actionLabel="Close"
                onAction={onClose}
                palette={palette}
                icon="receipt-text-remove-outline"
              />
            )}
          </Animated.View>
        </KeyboardAvoidingView>
        {receiptImagePrintBridge}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
  },
  bottomSheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  expansiveBottomSheet: {
    minHeight: "76%",
    maxHeight: "94%",
  },
  sheetHandle: {
    width: 54,
    height: 5,
    borderRadius: 999,
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTextWrap: {
    flex: 1,
  },
  headerSaveButton: {
    minHeight: 40,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  headerSaveButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    fontSize: 21,
    fontWeight: "800",
  },
  sheetSubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 32,
  },
  loadingText: {
    fontSize: 13,
  },
  sheetContent: {
    gap: 14,
    paddingBottom: 14,
  },
  sheetScroll: {
    flexShrink: 1,
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.9,
  },
  sheetField: {
    minHeight: 54,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sheetFieldValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
  },
  optionMenu: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
  },
  optionItem: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 4,
  },
  optionTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  optionSubtitle: {
    fontSize: 12,
  },
  previewCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 16,
    gap: 6,
  },
  previewLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  previewValue: {
    fontSize: 22,
    fontWeight: "800",
  },
  previewMeta: {
    fontSize: 12,
  },
  currencyPrefix: {
    fontSize: 15,
    fontWeight: "700",
  },
  sheetInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
  },
  inputIconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  inlineError: {
    fontSize: 12,
    lineHeight: 18,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 18,
  },
  summaryCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 15,
    gap: 8,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  summaryText: {
    fontSize: 13,
    lineHeight: 18,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
    paddingTop: 8,
  },
  editActionsColumn: {
    gap: 12,
    paddingTop: 8,
  },
  receiptPreviewWrap: {
    alignItems: "center",
  },
  receiptPreviewFrame: {
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: 18,
  },
  printFooter: {
    marginTop: 10,
    marginHorizontal: -18,
    marginBottom: -18,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 20,
    borderTopWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 8,
  },
  printFooterActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  footerButton: {
    width: "72%",
    maxWidth: 320,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  footerButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  footerButtonIconSlot: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  footerButtonText: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  footerButtonPrimaryText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#FFFFFF",
    lineHeight: 20,
  },
  createActionsWrap: {
    marginTop: 8,
    marginHorizontal: -18,
    marginBottom: -18,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
    borderTopWidth: 1,
  },
  sheetActionButton: {
    flex: 1,
  },
});
