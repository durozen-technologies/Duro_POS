import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { toApiError } from "@/api/client";
import {
  createOrganization,
  fetchOrganizationRows,
  patchOrganizationStatus,
  type OrganizationRead,
} from "@/api/super-admin";
import type { AppStackParamList } from "@/navigation/types";

type Nav = NativeStackNavigationProp<AppStackParamList, "SuperAdminOrgs">;

const ACCENT = "#0F7642";
const INK = "#0A110D";
const MUTED = "#4B6356";

function formatSlug(slug: string) {
  return slug;
}

export function SuperAdminOrgsScreen() {
  const navigation = useNavigation<Nav>();
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<OrganizationRead[]>([]);
  const [newOrgName, setNewOrgName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ponytail: track which org is toggling so its button shows a spinner
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items } = await fetchOrganizationRows();
      setOrgs(items);
    } catch (err) {
      setError(toApiError(err).message || "Failed to load organizations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    const name = newOrgName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      await createOrganization({ name });
      setNewOrgName("");
      await load();
    } catch (err) {
      setError(toApiError(err).message || "Failed to create organization");
    } finally {
      setCreating(false);
    }
  };

  const confirmToggle = (org: OrganizationRead) => {
    if (org.is_active) {
      Alert.alert(
        "Disable Organization?",
        `${org.name} and all its admins will lose access immediately.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Disable",
            style: "destructive",
            onPress: () => void doToggle(org),
          },
        ],
      );
    } else {
      void doToggle(org);
    }
  };

  const doToggle = async (org: OrganizationRead) => {
    setTogglingId(org.id);
    setError(null);
    try {
      await patchOrganizationStatus(org.id, !org.is_active);
      await load();
    } catch (err) {
      setError(toApiError(err).message || "Failed to update organization");
    } finally {
      setTogglingId(null);
    }
  };

  const activeCount = orgs.filter((o) => o.is_active).length;

  const renderOrg = ({
    item: org,
    index,
  }: {
    item: OrganizationRead;
    index: number;
  }) => {
    const toggling = togglingId === org.id;
    return (
      <View
        className={`flex-row items-center px-4 py-3 ${index < orgs.length - 1 ? "border-b border-border" : ""}`}
      >
        {/* Status indicator */}
        <View
          className={`mr-3 h-2.5 w-2.5 rounded-full ${org.is_active ? "bg-success" : "bg-border"}`}
        />

        {/* Info */}
        <View className="flex-1 pr-3">
          <Text className="font-semibold text-ink" numberOfLines={1}>
            {org.name}
          </Text>
          <Text className="mt-0.5 text-xs text-muted">
            {formatSlug(org.slug)}
          </Text>
        </View>

        {/* Toggle button — spinner while toggling */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            org.is_active ? `Disable ${org.name}` : `Enable ${org.name}`
          }
          className={`min-h-[36px] min-w-[76px] items-center justify-center rounded-control border px-3 ${
            toggling ? "opacity-50" : "active:opacity-80"
          } ${org.is_active ? "border-border bg-card" : "border-transparent bg-accent"}`}
          disabled={toggling || togglingId != null}
          onPress={() => confirmToggle(org)}
        >
          {toggling ? (
            <ActivityIndicator
              size="small"
              color={org.is_active ? INK : "#fff"}
            />
          ) : (
            <Text
              className={`text-sm font-medium ${org.is_active ? "text-ink" : "text-white"}`}
            >
              {org.is_active ? "Disable" : "Enable"}
            </Text>
          )}
        </Pressable>
      </View>
    );
  };

  const listHeader = (
    <View>
      {/* Create form */}
      <View className="px-4 pb-2 pt-4">
        <Text className="mb-2 text-base font-semibold text-ink">
          New Organization
        </Text>
        <View className="flex-row gap-2">
          <TextInput
            accessibilityLabel="Organization name"
            autoCapitalize="words"
            autoCorrect={false}
            className="min-h-[44px] flex-1 rounded-control border border-border bg-card px-4 py-2 text-sm text-ink"
            placeholder="e.g. Acme Retail"
            placeholderTextColor={MUTED}
            returnKeyType="done"
            value={newOrgName}
            onChangeText={setNewOrgName}
            onSubmitEditing={() => void handleCreate()}
          />
          <Pressable
            accessibilityRole="button"
            className={`min-h-[44px] items-center justify-center rounded-control bg-accent px-5 ${creating || !newOrgName.trim() ? "opacity-50" : "active:opacity-80"}`}
            disabled={creating || !newOrgName.trim()}
            onPress={() => void handleCreate()}
          >
            {creating ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-sm font-semibold text-white">Create</Text>
            )}
          </Pressable>
        </View>

        {error ? (
          <View className="mt-3 rounded-control border border-dangerSoft bg-dangerSoft px-4 py-3">
            <Text className="text-sm text-danger">{error}</Text>
          </View>
        ) : null}
      </View>

      {/* Column header */}
      <View className="flex-row items-center border-y border-border bg-surface px-4 py-2 mt-4">
        <View className="mr-3 w-2.5" />
        <Text className="flex-1 pl-3 text-xs font-semibold text-muted">
          Organization
        </Text>
        <View className="w-[76px]" />
      </View>
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <View className="mx-auto w-full max-w-5xl flex-1">
        {/* Screen header */}
        <View className="flex-row items-center gap-3 px-4 pb-2 pt-10">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            className="min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-border bg-card active:opacity-80"
            onPress={() => navigation.goBack()}
          >
            <MaterialCommunityIcons name="arrow-left" size={20} color={INK} />
          </Pressable>
          <View className="flex-1">
            <Text className="text-2xl font-bold text-ink">Organizations</Text>
            {!loading && orgs.length > 0 ? (
              <Text className="mt-0.5 text-xs text-muted">
                {activeCount} active · {orgs.length - activeCount} inactive
              </Text>
            ) : null}
          </View>
        </View>

        {/* List */}
        {loading && orgs.length === 0 ? (
          <View>
            {listHeader}
            <ActivityIndicator className="mt-6" color={ACCENT} />
          </View>
        ) : (
          <FlatList
            data={orgs}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={listHeader}
            ListEmptyComponent={
              <View className="mt-10 items-center px-8">
                <MaterialCommunityIcons
                  name="domain-off"
                  size={40}
                  color={MUTED}
                />
                <Text className="mt-3 text-center text-sm font-medium text-ink">
                  No organizations yet
                </Text>
                <Text className="mt-1 text-center text-xs text-muted">
                  Create your first organization above.
                </Text>
              </View>
            }
            initialNumToRender={20}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews
            renderItem={renderOrg}
          />
        )}
      </View>
    </View>
  );
}
