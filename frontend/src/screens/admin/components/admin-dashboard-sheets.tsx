import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Controller } from "react-hook-form";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  TextInput,
  View,
} from "react-native";
import {
  Button as TButton,
  Input,
  ScrollView as TamaguiScrollView,
  Spinner,
  Text as TText,
  XStack,
  YStack,
} from "tamagui";
import { WebView } from "react-native-webview";

import { formatApiErrorMessage } from "@/api/client";
import { buildReceiptHtml } from "@/api/receipts";
import { AdminText as Text } from "@/components/ui/admin-text";
import { useAdminTranslation } from "@/hooks/use-admin-translation";
import { useReceiptImageShare } from "@/hooks/use-receipt-image-share";
import type { BillRead } from "@/types/api";
import { getReceiptPaperProfile } from "@/utils/receipt-paper";
import { useReceiptPaperMm } from "@/utils/printing";

import { adminElevation, type ThemePalette } from "../admin-dashboard-theme";
import { triggerHaptic } from "../admin-dashboard-utils";
import { EmptyStateCard, PrimaryButton } from "./admin-dashboard-primitives";

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
  const { t } = useAdminTranslation();
  const isEdit = mode === "edit";
  const [passwordVisible, setPasswordVisible] = useState(false);

  useEffect(() => {
    if (!visible) {
      setPasswordVisible(false);
    }
  }, [visible]);

  if (isEdit) {
    return (
      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
          style={[styles.centeredModalBackdrop, { backgroundColor: palette.overlay }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          <View style={styles.centeredKeyboardWrap} pointerEvents="box-none">
            <YStack
              width="100%"
              maxWidth={540}
              maxHeight="86%"
              borderRadius={24}
              borderWidth={1}
              padding={18}
              gap={16}
              style={[
                adminElevation(3),
                {
                  backgroundColor: palette.card,
                  borderColor: palette.border,
                },
              ]}
            >
              <XStack alignItems="flex-start" justifyContent="space-between" gap={12}>
                <YStack flex={1} minWidth={0} gap={5}>
                  <TText
                    color={palette.textPrimary}
                    fontSize={21}
                    lineHeight={27}
                    fontWeight="800"
                  >
                    {t("settings.manageAccess")}
                  </TText>
                  <TText color={palette.textMuted} fontSize={13} lineHeight={19} fontWeight="600">
                    {t("settings.manageAccessHint")}
                  </TText>
                </YStack>

                <TButton
                  accessibilityRole="button"
                  accessibilityLabel={t("a11y.closeManageAccess")}
                  width={42}
                  height={42}
                  padding={0}
                  borderRadius={14}
                  borderWidth={1}
                  borderColor={palette.border}
                  backgroundColor={palette.backgroundElevated}
                  pressStyle={{ scale: 0.97, backgroundColor: palette.surfaceMuted }}
                  onPress={onClose}
                >
                  <MaterialCommunityIcons name="close" size={18} color={palette.textPrimary} />
                </TButton>
              </XStack>

              <TamaguiScrollView
                style={styles.centeredDialogScroll}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.centeredDialogScrollContent}
              >
                <YStack gap={14}>
                  <Controller
                    control={control}
                    name="name"
                    render={({ field, fieldState }) => (
                      <YStack gap={8}>
                        <TText
                          color={palette.textMuted}
                          fontSize={11}
                          fontWeight="700"
                          textTransform="uppercase"
                          letterSpacing={0.9}
                        >
                          {t("forms.shopName")}
                        </TText>
                        <Input
                          value={field.value}
                          onChangeText={field.onChange}
                          placeholder={t("forms.enterBranchName")}
                          placeholderTextColor={palette.textMuted as never}
                          color={palette.textPrimary}
                          fontSize={15}
                          fontWeight="700"
                          minHeight={54}
                          borderRadius={16}
                          borderWidth={1}
                          borderColor={fieldState.error ? palette.danger : palette.border}
                          backgroundColor={palette.backgroundElevated}
                          paddingHorizontal={15}
                          accessibilityLabel={t("forms.enterShopName")}
                        />
                        {fieldState.error ? (
                          <TText color={palette.danger} fontSize={12} lineHeight={18}>
                            {fieldState.error.message}
                          </TText>
                        ) : null}
                      </YStack>
                    )}
                  />

                  <Controller
                    control={control}
                    name="username"
                    render={({ field, fieldState }) => (
                      <YStack gap={8}>
                        <TText
                          color={palette.textMuted}
                          fontSize={11}
                          fontWeight="700"
                          textTransform="uppercase"
                          letterSpacing={0.9}
                        >
                          {t("forms.loginUsername")}
                        </TText>
                        <Input
                          value={field.value}
                          onChangeText={field.onChange}
                          placeholder={t("forms.enterLoginUsername")}
                          autoCapitalize="none"
                          autoCorrect={false}
                          placeholderTextColor={palette.textMuted as never}
                          color={palette.textPrimary}
                          fontSize={15}
                          fontWeight="700"
                          minHeight={54}
                          borderRadius={16}
                          borderWidth={1}
                          borderColor={fieldState.error ? palette.danger : palette.border}
                          backgroundColor={palette.backgroundElevated}
                          paddingHorizontal={15}
                          accessibilityLabel={t("forms.enterLoginUsername")}
                        />
                        {fieldState.error ? (
                          <TText color={palette.danger} fontSize={12} lineHeight={18}>
                            {fieldState.error.message}
                          </TText>
                        ) : null}
                      </YStack>
                    )}
                  />

                  <Controller
                    control={control}
                    name="password"
                    render={({ field, fieldState }) => (
                      <YStack gap={8}>
                        <TText
                          color={palette.textMuted}
                          fontSize={11}
                          fontWeight="700"
                          textTransform="uppercase"
                          letterSpacing={0.9}
                        >
                          {t("forms.resetPassword")}
                        </TText>
                        <XStack
                          alignItems="center"
                          gap={8}
                          minHeight={54}
                          borderRadius={16}
                          borderWidth={1}
                          borderColor={fieldState.error ? palette.danger : palette.border}
                          backgroundColor={palette.backgroundElevated}
                          paddingHorizontal={15}
                        >
                          <Input
                            flex={1}
                            unstyled
                            value={field.value}
                            onChangeText={field.onChange}
                            placeholder={t("forms.leavePasswordBlank")}
                            autoCapitalize="none"
                            autoCorrect={false}
                            secureTextEntry={!passwordVisible}
                            placeholderTextColor={palette.textMuted as never}
                            color={palette.textPrimary}
                            fontSize={15}
                            fontWeight="700"
                            paddingVertical={14}
                            accessibilityLabel={t("forms.enterLoginPassword")}
                          />
                          <TButton
                            accessibilityRole="button"
                            accessibilityLabel={passwordVisible ? t("a11y.hidePassword") : t("a11y.showPassword")}
                            width={36}
                            height={36}
                            padding={0}
                            borderRadius={12}
                            backgroundColor="transparent"
                            pressStyle={{ scale: 0.97, backgroundColor: palette.surfaceMuted }}
                            onPress={() => setPasswordVisible((current) => !current)}
                          >
                            <MaterialCommunityIcons
                              name={passwordVisible ? "eye-off-outline" : "eye-outline"}
                              size={20}
                              color={palette.textMuted}
                            />
                          </TButton>
                        </XStack>
                        {fieldState.error ? (
                          <TText color={palette.danger} fontSize={12} lineHeight={18}>
                            {fieldState.error.message}
                          </TText>
                        ) : null}
                      </YStack>
                    )}
                  />
                </YStack>
              </TamaguiScrollView>

              <YStack gap={10}>
                <TButton
                  minHeight={50}
                  borderRadius={16}
                  borderWidth={1}
                  borderColor={palette.settings}
                  backgroundColor={palette.settingsSoft}
                  disabled={loading || deleting || statusLoading}
                  opacity={loading || deleting || statusLoading ? 0.72 : 1}
                  pressStyle={{ scale: 0.985, backgroundColor: palette.backgroundElevated }}
                  onPress={onSubmit}
                >
                  <XStack alignItems="center" justifyContent="center" gap={8}>
                    {loading ? (
                      <Spinner color={palette.settings} />
                    ) : (
                      <MaterialCommunityIcons name="content-save-outline" size={18} color={palette.settings} />
                    )}
                    <TText color={palette.settingsStrong} fontSize={14} fontWeight="800">
                      {loading ? t("action.saving") : t("action.saveChanges")}
                    </TText>
                  </XStack>
                </TButton>

                <XStack gap={10} flexWrap="wrap">
                  {onToggleActive ? (
                    <TButton
                      flex={1}
                      minWidth={150}
                      minHeight={48}
                      borderRadius={16}
                      borderWidth={1}
                      borderColor={isActive ? palette.cash : palette.success}
                      backgroundColor={isActive ? palette.cashSoft : palette.successSoft}
                      disabled={loading || deleting || statusLoading}
                      opacity={statusLoading ? 0.72 : 1}
                      pressStyle={{ scale: 0.985, backgroundColor: palette.backgroundElevated }}
                      onPress={onToggleActive}
                    >
                      <XStack alignItems="center" justifyContent="center" gap={8}>
                        {statusLoading ? (
                          <Spinner color={isActive ? palette.cash : palette.success} />
                        ) : (
                          <MaterialCommunityIcons
                            name={isActive ? "pause-circle-outline" : "check-circle-outline"}
                            size={18}
                            color={isActive ? palette.cash : palette.success}
                          />
                        )}
                        <TText
                          color={isActive ? palette.cash : palette.success}
                          fontSize={13}
                          fontWeight="800"
                        >
                          {isActive ? t("settings.pauseAccess") : t("settings.activateShop")}
                        </TText>
                      </XStack>
                    </TButton>
                  ) : null}

                  {onDelete ? (
                    <TButton
                      flex={1}
                      minWidth={150}
                      minHeight={48}
                      borderRadius={16}
                      borderWidth={1}
                      borderColor={palette.danger}
                      backgroundColor={palette.dangerSoft}
                      disabled={loading || deleting || statusLoading}
                      opacity={deleting ? 0.72 : 1}
                      pressStyle={{ scale: 0.985, backgroundColor: palette.backgroundElevated }}
                      onPress={onDelete}
                    >
                      <XStack alignItems="center" justifyContent="center" gap={8}>
                        {deleting ? (
                          <Spinner color={palette.danger} />
                        ) : (
                          <MaterialCommunityIcons name="delete-outline" size={18} color={palette.danger} />
                        )}
                        <TText color={palette.danger} fontSize={13} fontWeight="800">
                          {deleting ? t("action.deleting") : t("settings.deleteShop")}
                        </TText>
                      </XStack>
                    </TButton>
                  ) : null}
                </XStack>
              </YStack>
            </YStack>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
        style={[styles.centeredModalBackdrop, { backgroundColor: palette.overlay }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.centeredKeyboardWrap} pointerEvents="box-none">
          <View
            style={[
              adminElevation(3),
              {
                width: "100%",
                maxWidth: 540,
                maxHeight: "86%",
                borderRadius: 12,
                borderWidth: 1,
                padding: 18,
                backgroundColor: palette.card,
                borderColor: palette.border,
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <View style={styles.headerTextWrap}>
                <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>
                  {isEdit ? t("settings.manageShop") : t("settings.createShop")}
                </Text>
                <Text style={[styles.sheetSubtitle, { color: palette.textMuted }]}>
                  {isEdit
                    ? t("settings.manageShopHint")
                    : t("settings.createShopHint")}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isEdit ? t("a11y.closeManageShop") : t("a11y.closeCreateShop")}
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
                      <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>{t("forms.shopName")}</Text>
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
                          placeholder={t("forms.enterBranchName")}
                          placeholderTextColor={palette.textMuted}
                          style={[styles.sheetInput, { color: palette.textPrimary }]}
                          accessibilityLabel={t("forms.enterShopName")}
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
                      <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>{t("forms.loginUsername")}</Text>
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
                          placeholder={t("forms.enterLoginUsername")}
                          autoCapitalize="none"
                          autoCorrect={false}
                          placeholderTextColor={palette.textMuted}
                          style={[styles.sheetInput, { color: palette.textPrimary }]}
                          accessibilityLabel={t("forms.enterLoginUsername")}
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
                        {isEdit ? t("forms.resetPassword") : t("forms.loginPassword")}
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
                          placeholder={isEdit ? t("forms.leavePasswordBlank") : t("forms.enterLoginPassword")}
                          autoCapitalize="none"
                          autoCorrect={false}
                          secureTextEntry={!passwordVisible}
                          placeholderTextColor={palette.textMuted}
                          style={[styles.sheetInput, { color: palette.textPrimary }]}
                          accessibilityLabel={t("forms.enterLoginPassword")}
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={passwordVisible ? t("a11y.hidePassword") : t("a11y.showPassword")}
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
                  label={t("action.saveChanges")}
                  onPress={onSubmit}
                  loading={loading}
                  disabled={deleting || statusLoading}
                  icon="content-save-outline"
                  variant="primary"
                  fullWidth
                  palette={palette}
                />

                <View style={styles.actionsRow}>
                  {onToggleActive ? (
                    <View style={styles.sheetActionButton}>
                      <PrimaryButton
                        label={isActive ? t("settings.pauseAccess") : t("settings.activateShop")}
                        onPress={onToggleActive}
                        loading={statusLoading}
                        disabled={loading || deleting}
                        variant={isActive ? "warning" : "success"}
                        icon={isActive ? "pause-circle-outline" : "check-circle-outline"}
                        fullWidth
                        palette={palette}
                      />
                    </View>
                  ) : null}
                  {onDelete ? (
                    <View style={styles.sheetActionButton}>
                      <PrimaryButton
                        label={t("settings.deleteShop")}
                        onPress={onDelete}
                        loading={deleting}
                        disabled={loading || statusLoading}
                        variant="danger"
                        fullWidth
                        palette={palette}
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
                      label={t("action.cancel")}
                      onPress={onClose}
                      variant="secondary"
                      icon="close"
                      fullWidth
                      palette={palette}
                    />
                  </View>
                  <View style={styles.sheetActionButton}>
                    <PrimaryButton
                      label={t("settings.createAccount")}
                      onPress={onSubmit}
                      loading={loading}
                      icon="store-plus-outline"
                      variant="primary"
                      fullWidth
                      palette={palette}
                    />
                  </View>
                </View>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
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
  const { t } = useAdminTranslation();
  const { panResponder, translateY } = useSwipeToClose(onClose);
  const [receiptPreviewHeight, setReceiptPreviewHeight] = useState(320);
  const [sharing, setSharing] = useState(false);
  const receiptPaperMm = useReceiptPaperMm();
  const receiptPreviewWidth = getReceiptPaperProfile(receiptPaperMm).webViewWidth;
  const { receiptImageShareBridge, startReceiptImageShare } = useReceiptImageShare();
  const receiptHtml = useMemo(
    () => (bill ? buildReceiptHtml(bill, undefined, receiptPaperMm) : ""),
    [bill, receiptPaperMm],
  );

  useEffect(() => {
    setReceiptPreviewHeight(320);
  }, [bill?.id]);

  const handleShareReceipt = useCallback(async () => {
    if (!bill || sharing) {
      return;
    }
    triggerHaptic();
    setSharing(true);
    try {
      await startReceiptImageShare(
        buildReceiptHtml(bill, undefined, receiptPaperMm),
        t("billing.receiptNumber", { billNumber: bill.bill_no }),
        receiptPaperMm,
      );
    } catch (error) {
      Alert.alert(t("billing.shareFailed"), formatApiErrorMessage(error));
    } finally {
      setSharing(false);
    }
  }, [bill, receiptPaperMm, sharing, startReceiptImageShare, t]);

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
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={[styles.modalBackdrop, { backgroundColor: palette.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <Animated.View
              {...panResponder.panHandlers}
              style={[
                styles.bottomSheet,
                adminElevation(3),
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
                  <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>{t("billing.billPreview")}</Text>
                  <Text style={[styles.sheetSubtitle, { color: palette.textMuted }]}>
                    {t("billing.billPreviewHint")}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("a11y.closeBillPreview")}
                  onPress={onClose}
                  style={[styles.iconButton, { backgroundColor: palette.backgroundElevated, borderColor: palette.border }]}
                >
                  <MaterialCommunityIcons name="close" size={18} color={palette.textPrimary} />
                </Pressable>
              </View>

              {loading ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator color={palette.billing} />
                  <Text style={[styles.loadingText, { color: palette.textSecondary }]}>{t("billing.loadingBillPreview")}</Text>
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
                            width: receiptPreviewWidth,
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
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("a11y.shareReceipt", { billNumber: bill.bill_no })}
                    accessibilityState={{ disabled: sharing }}
                    disabled={sharing}
                    onPress={() => {
                      void handleShareReceipt();
                    }}
                    style={({ pressed }) => [
                      styles.shareButton,
                      {
                        borderColor: palette.border,
                        backgroundColor: pressed ? palette.surfaceMuted : palette.background,
                        opacity: sharing ? 0.7 : 1,
                      },
                    ]}
                  >
                    <View style={styles.shareButtonContent}>
                      {sharing ? (
                        <ActivityIndicator color={palette.primary} size="small" />
                      ) : (
                        <MaterialCommunityIcons name="share-variant" size={18} color={palette.primary} />
                      )}
                      <Text style={[styles.shareButtonLabel, { color: palette.primary }]}>
                        {sharing ? t("action.preparing") : t("billing.shareReceipt")}
                      </Text>
                    </View>
                  </Pressable>
                </>
              ) : (
                <EmptyStateCard
                  title={t("billing.billPreviewUnavailable")}
                  subtitle={t("billing.billPreviewUnavailableHint")}
                  actionLabel={t("action.close")}
                  onAction={onClose}
                  palette={palette}
                  icon="receipt-text-remove-outline"
                />
              )}
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
      {receiptImageShareBridge}
    </>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
  },
  centeredModalBackdrop: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 24,
  },
  centeredKeyboardWrap: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  centeredDialogScroll: {
    flexShrink: 1,
  },
  centeredDialogScrollContent: {
    paddingBottom: 2,
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
    gap: 12,
  },
  headerTextWrap: {
    flex: 1,
  },
  headerSaveButton: {
    minHeight: 40,
    borderRadius: 12,
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
    borderRadius: 12,
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
    gap: 12,
    paddingVertical: 32,
  },
  loadingText: {
    fontSize: 13,
  },
  sheetContent: {
    gap: 16,
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
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sheetFieldValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
  },
  optionMenu: {
    borderRadius: 12,
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
    borderRadius: 12,
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
    borderRadius: 12,
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
    borderRadius: 12,
  },
  shareButton: {
    marginTop: 12,
    width: "100%",
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  shareButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  shareButtonLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "center",
    includeFontPadding: false,
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
