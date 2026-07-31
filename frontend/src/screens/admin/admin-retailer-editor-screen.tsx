import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAdminTranslation } from "@/hooks/use-admin-translation";

import { StatusBar } from "expo-status-bar";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Switch,
  Text,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { createRetailer, deleteRetailer, updateRetailer } from "@/api/retailers";
import { formatApiErrorMessage } from "@/api/client";
import { AdminTextField } from "@/screens/admin/components/admin-text-field";
import type { AdminRetailerEditorScreenProps } from "@/navigation/types";

import { adminRadii } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { useAdminTheme } from "./use-admin-theme";
import { money, toMoneyString } from "@/utils/decimal";

export function AdminRetailerEditorScreen({ navigation, route }: AdminRetailerEditorScreenProps) {
  const { t } = useAdminTranslation();
  const { palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const initial = route.params?.initialRetailer;
  const [name, setName] = useState(initial?.name ?? "");
  const [shopName, setShopName] = useState(initial?.shop_name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [alternatePhone, setAlternatePhone] = useState(initial?.alternate_phone ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [openingBalance, setOpeningBalance] = useState("");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canDelete = initial?.can_delete !== false;

  const save = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedShopName = shopName.trim();
    const trimmedPhone = phone.trim();

    if (!trimmedName) {
      Alert.alert(t("retailers.requiredField"), t("retailers.enterName"));
      return;
    }
    if (!trimmedShopName) {
      Alert.alert(t("retailers.requiredField"), t("retailers.enterShopName"));
      return;
    }
    if (!trimmedPhone) {
      Alert.alert(t("retailers.requiredField"), t("retailers.enterMobile"));
      return;
    }
    if (trimmedPhone.length < 10) {
      Alert.alert(t("retailers.invalidPhone"), t("forms.mobileInvalid"));
      return;
    }
    if (!initial && openingBalance.trim() && money(openingBalance).lessThan(0)) {
      Alert.alert(t("retailers.invalidAmount"), t("retailers.openingBalanceNegative"));
      return;
    }

    const payload = {
      name: trimmedName,
      shop_name: trimmedShopName,
      phone: trimmedPhone,
      alternate_phone: alternatePhone.trim() || null,
      address: address.trim() || null,
      is_active: isActive,
      ...(!initial && openingBalance.trim()
        ? { opening_balance: toMoneyString(openingBalance) }
        : {}),
    };
    setSaving(true);
    try {
      if (initial) {
        await updateRetailer(initial.id, payload);
        triggerHaptic();
        navigation.goBack();
      } else {
        const created = await createRetailer(payload);
        triggerHaptic();
        navigation.replace("AdminRetailerBranches", {
          retailerId: created.id,
          retailerName: created.name,
          requireSelection: true,
        });
      }
    } catch (error) {
      Alert.alert(t("retailers.saveFailed"), formatApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [address, alternatePhone, initial, isActive, name, navigation, openingBalance, phone, shopName, t]);

  const confirmDelete = useCallback(() => {
    if (!initial) {
      return;
    }
    if (!canDelete) {
      Alert.alert(
        t("retailers.deleteRetailer"),
        t("retailers.cannotDeleteHistory"),
      );
      return;
    }
    Alert.alert(
      t("retailers.deleteRetailerConfirm"),
      t("retailers.deleteRetailerMessage", { name: initial.name }),
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setDeleting(true);
              try {
                await deleteRetailer(initial.id);
                triggerHaptic();
                navigation.navigate("AdminRetailers");
              } catch (error) {
                Alert.alert(t("retailers.deleteFailed"), formatApiErrorMessage(error));
              } finally {
                setDeleting(false);
              }
            })();
          },
        },
      ],
    );
  }, [canDelete, initial, navigation, t]);

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
          {initial ? t("retailers.editRetailer") : t("retailers.newRetailer")}
        </Text>
      </View>
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 14 }}
        enableOnAndroid
        keyboardShouldPersistTaps="handled"
      >
          <AdminTextField label={`${t("retailers.name")} *`} palette={palette} value={name} onChangeText={setName} />
          <AdminTextField
            label={`${t("forms.shopName")} *`}
            palette={palette}
            value={shopName}
            onChangeText={setShopName}
          />
          <AdminTextField
            label={`${t("forms.mobile")} *`}
            palette={palette}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <AdminTextField
            label={t("forms.alternateMobile")}
            palette={palette}
            value={alternatePhone}
            onChangeText={setAlternatePhone}
            keyboardType="phone-pad"
          />
          <AdminTextField
            label={`${t("forms.address")} (${t("common.optional")})`}
            palette={palette}
            value={address}
            onChangeText={setAddress}
            multiline
          />
          {!initial ? (
            <AdminTextField
              label={`${t("forms.openingBalance")} (${t("common.optional")})`}
              palette={palette}
              value={openingBalance}
              onChangeText={setOpeningBalance}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          ) : null}
          {initial ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                borderRadius: adminRadii.card,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: palette.card,
                padding: 14,
              }}
            >
              <Text style={{ color: palette.textPrimary, fontWeight: "600" }}>{t("retailers.active")}</Text>
              <Switch value={isActive} onValueChange={setIsActive} />
            </View>
          ) : null}
          <Pressable
            onPress={() => void save()}
            disabled={saving || deleting}
            style={{
              marginTop: 8,
              borderRadius: adminRadii.card,
              backgroundColor: palette.primary,
              paddingVertical: 14,
              alignItems: "center",
              opacity: saving || deleting ? 0.7 : 1,
            }}
          >
            {saving ? (
              <ActivityIndicator color={palette.onPrimary} />
            ) : (
              <Text style={{ color: palette.onPrimary, fontWeight: "700" }}>{t("retailers.saveRetailer")}</Text>
            )}
          </Pressable>
          {initial ? (
            <Pressable
              onPress={confirmDelete}
              disabled={saving || deleting || !canDelete}
              style={{
                marginTop: 4,
                borderRadius: adminRadii.card,
                borderWidth: 1,
                borderColor: palette.danger,
                backgroundColor: palette.dangerSoft,
                paddingVertical: 14,
                alignItems: "center",
                opacity: saving || deleting || !canDelete ? 0.6 : 1,
              }}
            >
              {deleting ? (
                <ActivityIndicator color={palette.danger} />
              ) : (
                <Text style={{ color: palette.danger, fontWeight: "700" }}>
                  {canDelete ? t("retailers.deleteRetailer") : t("retailers.cannotDeleteHistory")}
                </Text>
              )}
            </Pressable>
          ) : null}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
