import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { toApiError } from "@/api/client";
import {
  hardDeleteBranch,
  hardDeleteOrganization,
  hardDeleteTenantAdmin,
} from "@/api/super-admin";
import type { AppStackParamList } from "@/navigation/types";
import { useAuthStore } from "@/store/auth-store";

type Nav = NativeStackNavigationProp<AppStackParamList, "SuperAdminHardDelete">;
type Route = RouteProp<AppStackParamList, "SuperAdminHardDelete">;

const MUTED = "#4B6356";
const INK = "#0A110D";

export function SuperAdminHardDeleteScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { resourceType, resourceId, resourceName, organizationId } = route.params;
  
  const signedInUsername = useAuthStore((state) => state.user?.username ?? "");
  const [username, setUsername] = useState(signedInUsername);
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = username.trim().length >= 3 && password.length >= 1 && !busy;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    try {
      const credentials = { username: username.trim().toLowerCase(), password };
      if (resourceType === "organization") {
        await hardDeleteOrganization(resourceId, credentials);
      } else if (resourceType === "tenantAdmin") {
        await hardDeleteTenantAdmin(resourceId, credentials);
      } else if (resourceType === "branch" && organizationId) {
        await hardDeleteBranch(organizationId, resourceId, credentials);
      }
      navigation.goBack();
    } catch (err) {
      setError(toApiError(err).message || "Hard delete failed");
    } finally {
      setBusy(false);
    }
  };

  let title = "Hard Delete";
  let message = "This action is permanent and cannot be undone.";
  if (resourceType === "organization") {
    title = "Hard Delete Organization";
    message =
      "This will permanently delete the organization, its tenant schema, branches, admins, and all related data.";
  } else if (resourceType === "tenantAdmin") {
    title = "Hard Delete Tenant Admin";
    message =
      "This will permanently remove the tenant admin account and revoke their access.";
  } else if (resourceType === "branch") {
    title = "Hard Delete Branch";
    message =
      "This will permanently remove the branch, but keep the parent organization intact.";
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-background"
    >
      <View className="mx-auto w-full max-w-lg flex-1 px-4 pt-10">
        <Pressable
          accessibilityRole="button"
          className="mb-8 min-h-[44px] min-w-[44px] self-start items-center justify-center rounded-control border border-border bg-card active:opacity-80"
          onPress={() => navigation.goBack()}
        >
          <MaterialCommunityIcons name="arrow-left" size={20} color={INK} />
        </Pressable>

        <View className="mb-8 flex-row items-start gap-4">
          <View className="h-14 w-14 items-center justify-center rounded-full bg-dangerSoft">
            <MaterialCommunityIcons
              name="alert-octagon-outline"
              size={32}
              color="#DC2626"
            />
          </View>
          <View className="flex-1 justify-center py-1">
            <Text className="text-2xl font-bold text-ink">{title}</Text>
            <Text className="mt-1 text-base font-semibold text-muted">
              {resourceName}
            </Text>
          </View>
        </View>

        <View className="mb-8 rounded-card border border-dangerSoft bg-dangerSoft p-5">
          <Text className="text-base font-medium leading-relaxed text-danger">
            {message}
          </Text>
          <Text className="mt-2 text-sm font-bold uppercase tracking-wider text-danger">
            This action cannot be undone
          </Text>
        </View>

        <View className="gap-5">
          <View>
            <Text className="mb-2 text-sm font-semibold text-muted">
              Super Admin Username
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              className="min-h-[52px] rounded-control border border-border bg-card px-4 py-2 text-base text-ink shadow-sm"
              placeholder="Your username"
              placeholderTextColor={MUTED}
              value={username}
              onChangeText={setUsername}
            />
          </View>
          <View>
            <Text className="mb-2 text-sm font-semibold text-muted">
              Super Admin Password
            </Text>
            <View className="flex-row items-center gap-2">
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                className="min-h-[52px] flex-1 rounded-control border border-border bg-card px-4 py-2 text-base text-ink shadow-sm"
                placeholder="Confirm your password"
                placeholderTextColor={MUTED}
                secureTextEntry={!passwordVisible}
                value={password}
                onChangeText={setPassword}
              />
              <Pressable
                className="min-h-[52px] min-w-[52px] items-center justify-center rounded-control border border-border bg-card shadow-sm"
                onPress={() => setPasswordVisible((v) => !v)}
              >
                <MaterialCommunityIcons
                  name={passwordVisible ? "eye-off-outline" : "eye-outline"}
                  size={22}
                  color={MUTED}
                />
              </Pressable>
            </View>
          </View>
        </View>

        {error ? (
          <View className="mt-6 rounded-control border border-dangerSoft bg-dangerSoft px-4 py-3">
            <Text className="text-sm text-danger">{error}</Text>
          </View>
        ) : null}

        <View className="flex-1" />
        
        <Pressable
          className={`mb-8 min-h-[56px] items-center justify-center rounded-control bg-danger px-4 ${
            !canSubmit ? "opacity-50" : "active:opacity-80"
          }`}
          disabled={!canSubmit}
          onPress={() => void handleConfirm()}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-lg font-bold text-white">
              Permanently Delete
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
