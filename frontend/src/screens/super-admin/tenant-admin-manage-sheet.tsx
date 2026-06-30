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
  onToggleStatus: (admin: TenantAdminRead, nextActive: boolean) => Promise<void>;
  onResetPassword: (admin: TenantAdminRead, password: string) => Promise<void>;
  onUpdateRoles: (admin: TenantAdminRead, roleIds: string[]) => Promise<void>;
  onDelete: (admin: TenantAdminRead) => Promise<void>;
};

function formatTimestamp(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

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
      "Disable tenant admin?",
      `${admin.username} will not be able to sign in until re-enabled.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disable",
          style: "destructive",
          onPress: () => void runAction("status", () => onToggleStatus(admin, false)),
        },
      ],
    );
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete tenant admin permanently?",
      `This removes ${admin.username} and cannot be undone.`,
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
      current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 justify-end bg-black/40"
      >
        <Pressable accessibilityRole="button" className="flex-1" onPress={onClose} />
        <View className="max-h-[88%] rounded-t-2xl bg-white px-4 pb-8 pt-4">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Text className="text-xl font-semibold text-neutral-900">{admin.username}</Text>
              <Text className="mt-1 text-sm text-neutral-600">{admin.organization_name}</Text>
              <Text className="mt-1 text-xs text-neutral-500">
                {admin.is_active ? "Active" : "Disabled"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close manage tenant admin"
              className="rounded-lg bg-neutral-100 p-2"
              onPress={onClose}
            >
              <MaterialCommunityIcons name="close" size={20} color="#171717" />
            </Pressable>
          </View>

          <ScrollView className="mt-4" keyboardShouldPersistTaps="handled">
            <Text className="text-sm font-medium text-neutral-700">Account details</Text>
            <Text className="mt-1 text-xs text-neutral-500">
              Created {formatTimestamp(admin.created_at)}
            </Text>
            <Text className="mt-1 text-xs text-neutral-500">
              Last login {formatTimestamp(admin.last_login_at)}
            </Text>

            <Text className="mt-5 text-sm font-medium text-neutral-700">Status</Text>
            <Pressable
              accessibilityRole="button"
              className="mt-2 items-center rounded-lg bg-neutral-900 px-4 py-2"
              disabled={busyAction != null}
              onPress={() =>
                admin.is_active
                  ? confirmDisable()
                  : void runAction("status", () => onToggleStatus(admin, true))
              }
            >
              {busyAction === "status" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="font-medium text-white">
                  {admin.is_active ? "Disable account" : "Enable account"}
                </Text>
              )}
            </Pressable>

            <Text className="mt-5 text-sm font-medium text-neutral-700">Reset password</Text>
            <View className="mt-2 flex-row items-center gap-2">
              <TextInput
                accessibilityLabel="New password"
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2"
                placeholder="New password (min 8 characters)"
                secureTextEntry={!passwordVisible}
                value={password}
                onChangeText={setPassword}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={passwordVisible ? "Hide password" : "Show password"}
                className="rounded-lg bg-neutral-100 p-2"
                onPress={() => setPasswordVisible((current) => !current)}
              >
                <MaterialCommunityIcons
                  name={passwordVisible ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color="#404040"
                />
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              className="mt-2 items-center rounded-lg border border-neutral-300 px-4 py-2"
              disabled={busyAction != null || password.length < 8}
              onPress={() =>
                void runAction("password", async () => {
                  await onResetPassword(admin, password);
                  setPassword("");
                })
              }
            >
              {busyAction === "password" ? (
                <ActivityIndicator />
              ) : (
                <Text className="font-medium text-neutral-800">Update password</Text>
              )}
            </Pressable>

            <Text className="mt-5 text-sm font-medium text-neutral-700">Roles</Text>
            {loadingRoles ? (
              <ActivityIndicator className="mt-2" />
            ) : (
              <View className="mt-2 flex-row flex-wrap gap-2">
                {roles.map((role) => {
                  const selected = selectedRoleIds.includes(role.id);
                  return (
                    <Pressable
                      key={role.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      className={`rounded-lg px-3 py-2 ${selected ? "bg-neutral-900" : "bg-neutral-100"}`}
                      onPress={() => toggleRole(role.id)}
                    >
                      <Text className={selected ? "text-white" : "text-neutral-700"}>{role.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              className="mt-2 items-center rounded-lg border border-neutral-300 px-4 py-2"
              disabled={busyAction != null || selectedRoleIds.length === 0}
              onPress={() =>
                void runAction("roles", () => onUpdateRoles(admin, selectedRoleIds))
              }
            >
              {busyAction === "roles" ? (
                <ActivityIndicator />
              ) : (
                <Text className="font-medium text-neutral-800">Save roles</Text>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              className="mt-6 items-center rounded-lg bg-red-600 px-4 py-3"
              disabled={busyAction != null}
              onPress={confirmDelete}
            >
              {busyAction === "delete" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="font-semibold text-white">Delete permanently</Text>
              )}
            </Pressable>

            {error ? <Text className="mt-3 text-sm text-red-600">{error}</Text> : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
