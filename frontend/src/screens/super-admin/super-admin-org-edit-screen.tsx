import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";

import { toApiError } from "@/api/client";
import {
  fetchOrganizationRows,
  patchOrganization,
  type OrganizationRead,
} from "@/api/super-admin";
import type { AppStackParamList } from "@/navigation/types";

import { SuperAdminRefreshButton } from "./super-admin-refresh-button";

type RouteProps = NativeStackScreenProps<AppStackParamList, "SuperAdminOrgEdit">["route"];
type NavProps = NativeStackNavigationProp<AppStackParamList, "SuperAdminOrgEdit">;

const MUTED = "#4B6356";
const INK = "#0A110D";

export function SuperAdminOrgEditScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<NavProps>();
  const { org: initialOrg } = route.params;

  const [org, setOrg] = useState<OrganizationRead>(initialOrg);
  const [name, setName] = useState(initialOrg.name);
  const [maxBranches, setMaxBranches] = useState(String(initialOrg.max_branches));
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadOrg = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const { items } = await fetchOrganizationRows();
      const latest = items.find((item) => item.id === org.id);
      if (latest) {
        setOrg(latest);
        setName(latest.name);
        setMaxBranches(String(latest.max_branches));
      }
    } catch (reloadError) {
      setError(toApiError(reloadError).message || "Failed to refresh organization");
    } finally {
      setRefreshing(false);
    }
  }, [org.id]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    const limit = Number.parseInt(maxBranches, 10);
    if (trimmedName.length < 2) {
      setError("Organization name must be at least 2 characters.");
      return;
    }
    if (!Number.isFinite(limit) || limit < 1) {
      setError("Branch limit must be at least 1.");
      return;
    }
    if (limit < org.branch_count) {
      setError(`Branch limit cannot be below the current branch count (${org.branch_count}).`);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await patchOrganization(org.id, {
        name: trimmedName !== org.name ? trimmedName : undefined,
        max_branches: limit !== org.max_branches ? limit : undefined,
      });
      navigation.goBack();
    } catch (saveError) {
      setError(toApiError(saveError).message || "Failed to update organization");
      setSaving(false);
    }
  };

  const hasChanges =
    name.trim() !== org.name || Number.parseInt(maxBranches, 10) !== org.max_branches;

  return (
    <View className="flex-1 bg-background">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <View className="mx-auto w-full max-w-5xl flex-1 px-4 pt-10">
          {/* Screen header */}
          <View className="flex-row items-center gap-4 pb-6">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              className="min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-border bg-card active:opacity-80"
              onPress={() => navigation.goBack()}
            >
              <MaterialCommunityIcons name="arrow-left" size={20} color={INK} />
            </Pressable>
            <View className="flex-1 justify-center">
              <Text className="text-3xl font-bold tracking-tight text-ink">Edit Organization</Text>
              <Text className="mt-1 text-sm font-medium text-muted">{org.slug}</Text>
            </View>
            <SuperAdminRefreshButton
              onRefresh={reloadOrg}
              refreshing={refreshing}
              disabled={saving}
            />
          </View>

          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
          >
          {/* Form */}
          <View className="mt-2 gap-6 rounded-3xl bg-card p-6 border border-border shadow-sm">
            <View className="gap-2">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted">
                Organization name
              </Text>
              <TextInput
                accessibilityLabel="Organization name"
                autoCapitalize="words"
                className="min-h-[48px] rounded-control border border-border bg-surface px-4 py-2 text-base text-ink"
                placeholder="Organization name"
                placeholderTextColor={MUTED}
                value={name}
                onChangeText={setName}
              />
            </View>

            <View className="gap-2">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted">
                Maximum branches
              </Text>
              <TextInput
                accessibilityLabel="Maximum branches"
                keyboardType="number-pad"
                className="min-h-[48px] rounded-control border border-border bg-surface px-4 py-2 text-base text-ink"
                placeholder="5"
                placeholderTextColor={MUTED}
                value={maxBranches}
                onChangeText={setMaxBranches}
              />
              <Text className="text-xs text-muted">
                {org.branch_count} in use · {org.remaining_branches} remaining
              </Text>
            </View>

            {error ? (
              <View className="rounded-control border border-dangerSoft bg-dangerSoft px-4 py-3">
                <Text className="text-sm font-medium text-danger">{error}</Text>
              </View>
            ) : null}

            <View className="mt-4 flex-row gap-3">
              <Pressable
                accessibilityRole="button"
                className="min-h-[48px] flex-1 items-center justify-center rounded-control border border-border bg-surface active:opacity-80"
                disabled={saving}
                onPress={() => navigation.goBack()}
              >
                <Text className="text-base font-medium text-ink">Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                className={`min-h-[48px] flex-1 items-center justify-center rounded-control bg-ink ${!hasChanges || saving ? "opacity-50" : "active:opacity-80"}`}
                disabled={!hasChanges || saving}
                onPress={() => void handleSave()}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-base font-semibold text-white">Save Changes</Text>
                )}
              </Pressable>
            </View>
          </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
