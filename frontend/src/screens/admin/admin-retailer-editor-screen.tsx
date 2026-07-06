import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { createRetailer, updateRetailer } from "@/api/retailers";
import { toApiError, formatApiErrorMessage } from "@/api/client";
import { AdminTextField } from "@/screens/admin/components/admin-text-field";
import type { AdminRetailerEditorScreenProps } from "@/navigation/types";

import { adminRadii } from "./admin-dashboard-theme";
import { triggerHaptic } from "./admin-dashboard-utils";
import { useAdminTheme } from "./use-admin-theme";

export function AdminRetailerEditorScreen({ navigation, route }: AdminRetailerEditorScreenProps) {
  const { palette } = useAdminTheme();
  const insets = useSafeAreaInsets();
  const initial = route.params?.initialRetailer;
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Name required", "Enter a retailer name.");
      return;
    }
    setSaving(true);
    try {
      if (initial) {
        await updateRetailer(initial.id, {
          name: trimmedName,
          phone: phone.trim() || null,
          notes: notes.trim() || null,
          is_active: isActive,
        });
        triggerHaptic();
        navigation.goBack();
      } else {
        const created = await createRetailer({
          name: trimmedName,
          phone: phone.trim() || null,
          notes: notes.trim() || null,
          is_active: isActive,
        });
        triggerHaptic();
        navigation.replace("AdminRetailerBranches", {
          retailerId: created.id,
          retailerName: created.name,
          requireSelection: true,
        });
      }
    } catch (error) {
      Alert.alert("Save failed", formatApiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [initial, isActive, name, navigation, notes, phone]);

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
          {initial ? "Edit retailer" : "New retailer"}
        </Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <AdminTextField label="Name" palette={palette} value={name} onChangeText={setName} />
          <AdminTextField label="Phone" palette={palette} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <AdminTextField label="Notes" palette={palette} value={notes} onChangeText={setNotes} multiline />
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
            <Text style={{ color: palette.textPrimary, fontWeight: "600" }}>Active</Text>
            <Switch value={isActive} onValueChange={setIsActive} />
          </View>
          <Pressable
            onPress={() => void save()}
            disabled={saving}
            style={{
              marginTop: 8,
              borderRadius: adminRadii.card,
              backgroundColor: palette.primary,
              paddingVertical: 14,
              alignItems: "center",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? (
              <ActivityIndicator color={palette.onPrimary} />
            ) : (
              <Text style={{ color: palette.onPrimary, fontWeight: "700" }}>Save retailer</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
