import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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

import { toApiError } from "@/api/client";
import type { AdminRoleRead, TenantAdminRead } from "@/api/super-admin";

type TenantAdminManageSheetProps = {
  visible: boolean;
  admin: TenantAdminRead | null;
  roles: AdminRoleRead[];
  loadingRoles: boolean;
  onClose: () => void;
  onToggleStatus: (
    admin: TenantAdminRead,
    nextActive: boolean,
  ) => Promise<void>;
  onResetPassword: (admin: TenantAdminRead, password: string) => Promise<void>;
  onUpdateRoles: (admin: TenantAdminRead, roleIds: string[]) => Promise<void>;
  onDelete: (admin: TenantAdminRead) => Promise<void>;
};

function formatTimestamp(value?: string | null) {
  if (!value) return "Never logged in";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const INK = "#0A110D";
const MUTED = "#4B6356";
const ACCENT = "#0F7642";

export function TenantAdminManageSheet({
  visible,
  admin,
  roles,
  loadingRoles,
  onClose,
  onToggleStatus,
  onResetPassword,
  onUpdateRoles,
  onDelete,
}: TenantAdminManageSheetProps) {
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setPassword("");
      setPasswordVisible(false);
      setError(null);
      setBusyAction(null);
      return;
    }
    setSelectedRoleIds(admin?.role_ids ?? []);
  }, [admin, visible]);

  if (!admin) {
    return null;
  }

  const busy = busyAction != null;

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyAction(key);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(toApiError(actionError).message || "Action failed");
    } finally {
      setBusyAction(null);
    }
  };

  const confirmDisable = () => {
    Alert.alert(
      "Disable this admin?",
      `${admin.username} will not be able to sign in until re-enabled.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disable",
          style: "destructive",
          onPress: () =>
            void runAction("status", () => onToggleStatus(admin, false)),
        },
      ],
    );
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete Admin",
      `Permanently delete ${admin.username}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            void runAction("delete", async () => {
              await onDelete(admin);
              onClose();
            }),
        },
      ],
    );
  };

  const toggleRole = (roleId: string) => {
    setSelectedRoleIds((current) =>
      current.includes(roleId)
        ? current.filter((id) => id !== roleId)
        : [...current, roleId],
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 justify-end bg-black/50"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          className="flex-1"
          onPress={onClose}
        />

        {/* Sheet — max-w-lg centers on tablet */}
        <View className="mx-auto max-h-[88%] w-full max-w-lg rounded-t-2xl bg-card px-5 pb-10 pt-4">
          {/* Drag handle */}
          <View className="mb-4 items-center">
            <View className="h-1 w-10 rounded-full bg-border" />
          </View>

          {/* Header */}
          <View className="flex-row items-start justify-between gap-3 pb-3">
            <View className="flex-1">
              <Text
                className="text-xl font-semibold text-ink"
                numberOfLines={1}
              >
                {admin.username}
              </Text>
              <Text className="mt-0.5 text-sm text-muted" numberOfLines={1}>
                {admin.organization_name}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              className="min-h-[44px] min-w-[44px] items-center justify-center rounded-control bg-surface active:opacity-80"
              onPress={onClose}
            >
              <MaterialCommunityIcons name="close" size={20} color={INK} />
            </Pressable>
          </View>

          <ScrollView
            className="mt-2"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Account details */}
            <View className="rounded-card border border-border bg-surface px-4 py-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm text-muted">Status</Text>
                <View
                  className={`rounded-full px-2.5 py-1 ${admin.is_active ? "bg-successSoft" : "bg-dangerSoft"}`}
                >
                  <Text
                    className={`text-xs font-semibold ${admin.is_active ? "text-success" : "text-danger"}`}
                  >
                    {admin.is_active ? "Active" : "Disabled"}
                  </Text>
                </View>
              </View>
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="text-sm text-muted">Created</Text>
                <Text className="text-sm font-medium text-ink">
                  {formatTimestamp(admin.created_at)}
                </Text>
              </View>
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="text-sm text-muted">Last login</Text>
                <Text className="text-sm font-medium text-ink">
                  {formatTimestamp(admin.last_login_at)}
                </Text>
              </View>
            </View>

            {/* Status toggle */}
            <View className="mt-6">
              <Text className="mb-2 text-sm font-semibold text-ink">
                Account Access
              </Text>
              <Pressable
                accessibilityRole="button"
                className={`min-h-[44px] items-center justify-center rounded-control px-4 py-2 ${
                  busy ? "opacity-50" : "active:opacity-80"
                } ${admin.is_active ? "border border-border bg-card" : "bg-accent"}`}
                disabled={busy}
                onPress={() =>
                  admin.is_active
                    ? confirmDisable()
                    : void runAction("status", () =>
                        onToggleStatus(admin, true),
                      )
                }
              >
                {busyAction === "status" ? (
                  <ActivityIndicator color={admin.is_active ? INK : "#fff"} />
                ) : (
                  <Text
                    className={`text-sm font-semibold ${admin.is_active ? "text-ink" : "text-white"}`}
                  >
                    {admin.is_active ? "Disable Account" : "Enable Account"}
                  </Text>
                )}
              </Pressable>
            </View>

            {/* Reset password */}
            <View className="mt-6">
              <Text className="mb-2 text-sm font-semibold text-ink">
                Reset Password
              </Text>
              <View className="flex-row items-center gap-2">
                <TextInput
                  accessibilityLabel="New password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="min-h-[44px] flex-1 rounded-control border border-border bg-background px-4 py-2 text-sm text-ink"
                  placeholder="New password (8+ characters)"
                  placeholderTextColor={MUTED}
                  returnKeyType="done"
                  secureTextEntry={!passwordVisible}
                  value={password}
                  onChangeText={setPassword}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    passwordVisible ? "Hide password" : "Show password"
                  }
                  className="min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-border bg-background active:bg-surface"
                  onPress={() => setPasswordVisible((current) => !current)}
                >
                  <MaterialCommunityIcons
                    name={passwordVisible ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color={MUTED}
                  />
                </Pressable>
              </View>
              <Pressable
                accessibilityRole="button"
                className={`mt-2 min-h-[44px] items-center justify-center rounded-control border border-border bg-card px-4 py-2 ${busy || password.length < 8 ? "opacity-50" : "active:bg-surface"}`}
                disabled={busy || password.length < 8}
                onPress={() =>
                  void runAction("password", async () => {
                    await onResetPassword(admin, password);
                    setPassword("");
                  })
                }
              >
                {busyAction === "password" ? (
                  <ActivityIndicator color={INK} />
                ) : (
                  <Text className="text-sm font-semibold text-ink">
                    Set New Password
                  </Text>
                )}
              </Pressable>
            </View>

            {/* Roles */}
            <View className="mt-6">
              <Text className="mb-2 text-sm font-semibold text-ink">
                Permissions
              </Text>
              {loadingRoles ? (
                <ActivityIndicator className="mt-2" color={ACCENT} />
              ) : roles.length === 0 ? (
                <Text className="text-sm text-muted">
                  No roles available for this organization.
                </Text>
              ) : (
                <View className="flex-row flex-wrap gap-2">
                  {roles.map((role) => {
                    const selected = selectedRoleIds.includes(role.id);
                    return (
                      <Pressable
                        key={role.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        className={`min-h-[44px] items-center justify-center rounded-control border px-4 py-2 active:opacity-80 ${selected ? "border-transparent bg-accent" : "border-border bg-card"}`}
                        onPress={() => toggleRole(role.id)}
                      >
                        <Text
                          className={`text-sm font-medium ${selected ? "text-white" : "text-ink"}`}
                        >
                          {role.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {roles.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  className={`mt-3 min-h-[44px] items-center justify-center rounded-control border border-border bg-card px-4 py-2 ${busy || selectedRoleIds.length === 0 ? "opacity-50" : "active:bg-surface"}`}
                  disabled={busy || selectedRoleIds.length === 0}
                  onPress={() =>
                    void runAction("roles", () =>
                      onUpdateRoles(admin, selectedRoleIds),
                    )
                  }
                >
                  {busyAction === "roles" ? (
                    <ActivityIndicator color={INK} />
                  ) : (
                    <Text className="text-sm font-semibold text-ink">
                      Update Roles
                    </Text>
                  )}
                </Pressable>
              )}
            </View>

            {/* Error */}
            {error ? (
              <View className="mt-4 rounded-control border border-dangerSoft bg-dangerSoft px-4 py-3">
                <Text className="text-sm text-danger">{error}</Text>
              </View>
            ) : null}

            {/* Danger zone */}
            <View className="mt-8 border-t border-border pt-6">
              <Text className="mb-3 text-sm font-semibold text-danger">
                Danger Zone
              </Text>
              <Pressable
                accessibilityRole="button"
                className={`min-h-[44px] items-center justify-center rounded-control border border-dangerSoft bg-dangerSoft px-4 py-3 ${busy ? "opacity-50" : "active:opacity-80"}`}
                disabled={busy}
                onPress={confirmDelete}
              >
                {busyAction === "delete" ? (
                  <ActivityIndicator color="#DC2626" />
                ) : (
                  <Text className="text-sm font-semibold text-danger">
                    Delete Admin
                  </Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
