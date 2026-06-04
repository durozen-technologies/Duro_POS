import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Controller } from "react-hook-form";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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

import { buildReceiptHtml } from "@/api/receipts";
import type { BillRead } from "@/types/api";

import { adminShadow, type ThemePalette } from "../admin-dashboard-theme";
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
                adminShadow(palette.shadow, 0.16, 18, 24),
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
                    Manage Access
                  </TText>
                  <TText color={palette.textMuted} fontSize={13} lineHeight={19} fontWeight="600">
                    Update branch details, change login credentials, or pause this branch account.
                  </TText>
                </YStack>

                <TButton
                  accessibilityRole="button"
                  accessibilityLabel="Close manage access popup"
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
                          Shop Name
                        </TText>
                        <Input
                          value={field.value}
                          onChangeText={field.onChange}
                          placeholder="Enter branch name"
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
                          accessibilityLabel="Enter shop name"
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
                          Login Username
                        </TText>
                        <Input
                          value={field.value}
                          onChangeText={field.onChange}
                          placeholder="Enter login username"
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
                          accessibilityLabel="Enter login username"
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
                          Reset Password
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
                            placeholder="Leave blank to keep the current password"
                            autoCapitalize="none"
                            autoCorrect={false}
                            secureTextEntry={!passwordVisible}
                            placeholderTextColor={palette.textMuted as never}
                            color={palette.textPrimary}
                            fontSize={15}
                            fontWeight="700"
                            paddingVertical={14}
                            accessibilityLabel="Enter login password"
                          />
                          <TButton
                            accessibilityRole="button"
                            accessibilityLabel={passwordVisible ? "Hide password" : "Show password"}
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
                      {loading ? "Saving..." : "Save Changes"}
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
                          {isActive ? "Pause Access" : "Activate Shop"}
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
                          {deleting ? "Deleting..." : "Delete Shop"}
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
                  backgroundColorOverride={palette.settingsSoft}
                  borderColorOverride={palette.settings}
                  textColorOverride={palette.settingsStrong}
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
                        backgroundColorOverride={isActive ? palette.cashSoft : palette.successSoft}
                        borderColorOverride={isActive ? palette.cash : palette.success}
                        textColorOverride={isActive ? palette.cash : palette.success}
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
                      backgroundColorOverride={palette.settingsSoft}
                      borderColorOverride={palette.settings}
                      textColorOverride={palette.settingsStrong}
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
  const [receiptPreviewHeight, setReceiptPreviewHeight] = useState(320);
  const receiptHtml = useMemo(() => (bill ? buildReceiptHtml(bill) : ""), [bill]);

  useEffect(() => {
    setReceiptPreviewHeight(320);
  }, [bill?.id]);

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
                <ActivityIndicator color={palette.billing} />
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
      </View>
    </Modal>
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
