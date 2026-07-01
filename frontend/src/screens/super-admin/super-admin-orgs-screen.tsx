import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { SkeletonList } from "@/components/ui/skeleton";

import { toApiError } from "@/api/client";
import {
  createOrganization,
  fetchOrganizationRows,
  patchOrganizationStatus,
  type OrganizationRead,
} from "@/api/super-admin";
import type { AppStackParamList } from "@/navigation/types";

import { SUPER_ADMIN_REFRESH_TINT, SuperAdminRefreshButton } from "./super-admin-refresh-button";

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
  const [refreshing, setRefreshing] = useState(false);
  const [orgs, setOrgs] = useState<OrganizationRead[]>([]);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgMaxBranches, setNewOrgMaxBranches] = useState("5");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ponytail: track which org is toggling so its button shows a spinner
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const { items } = await fetchOrganizationRows();
      setOrgs(items);
    } catch (err) {
      setError(toApiError(err).message || "Failed to load organizations");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    void load(true);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const handleCreate = async () => {
    const name = newOrgName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const limit = Number.parseInt(newOrgMaxBranches, 10);
      await createOrganization({
        name,
        max_branches: Number.isFinite(limit) && limit >= 1 ? limit : 5,
      });
      setNewOrgName("");
      setNewOrgMaxBranches("5");
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
        <View className="flex-1 pr-3 justify-center">
          <Text className="text-sm font-semibold text-ink leading-tight" numberOfLines={1}>
            {org.name}
          </Text>
          <View className="mt-1 flex-row items-center gap-2">
            <Text className="text-xs text-muted">
              {formatSlug(org.slug)}
            </Text>
            <View className="h-1 w-1 rounded-full bg-border" />
            <Text className="text-xs text-muted">
              {org.branch_count} / {org.max_branches} branches
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${org.name}`}
          className="mr-2 min-h-[36px] min-w-[36px] items-center justify-center rounded-control border border-border bg-card active:opacity-80"
          disabled={togglingId != null}
          onPress={() => navigation.navigate("SuperAdminOrgEdit", { org })}
        >
          <MaterialCommunityIcons name="pencil-outline" size={18} color={INK} />
        </Pressable>

        {/* Toggle button — spinner while toggling */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            org.is_active ? `Disable ${org.name}` : `Enable ${org.name}`
          }
          className={`min-h-[36px] min-w-[76px] items-center justify-center rounded-control border px-3 ${
            toggling ? "opacity-50" : "active:opacity-80"
          } ${org.is_active ? "border-transparent bg-dangerSoft" : "border-transparent bg-accent"}`}
          disabled={toggling || togglingId != null}
          onPress={() => confirmToggle(org)}
        >
          {toggling ? (
            <ActivityIndicator
              size="small"
              color={org.is_active ? "#DC2626" : "#fff"}
            />
          ) : (
            <Text
              className={`text-sm font-medium ${org.is_active ? "text-danger" : "text-white"}`}
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
      <View className="px-4 pb-6 pt-2">
        <Text className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
          New Organization
        </Text>
        <View className="flex-row gap-3">
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
          <TextInput
            accessibilityLabel="Maximum branches"
            keyboardType="number-pad"
            className="min-h-[44px] w-[72px] rounded-control border border-border bg-card px-3 py-2 text-center text-sm text-ink"
            placeholder="5"
            placeholderTextColor={MUTED}
            value={newOrgMaxBranches}
            onChangeText={setNewOrgMaxBranches}
          />
          <Pressable
            accessibilityRole="button"
            className={`min-h-[44px] min-w-[76px] items-center justify-center rounded-control bg-accent px-4 ${creating || !newOrgName.trim() ? "opacity-50" : "active:opacity-80"}`}
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
      <View className="flex-row items-center border-y border-border bg-surface px-4 py-2.5">
        <View className="mr-3 w-2.5" />
        <Text className="flex-1 pr-3 text-xs font-semibold uppercase tracking-wider text-muted">
          Organization
        </Text>
        <View className="mr-2 w-[36px]" />
        <View className="w-[76px]" />
      </View>
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <View className="mx-auto w-full max-w-5xl flex-1">
        {/* Screen header */}
        <View className="flex-row items-center gap-4 px-4 pb-6 pt-10">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            className="min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-border bg-card active:opacity-80"
            onPress={() => navigation.goBack()}
          >
            <MaterialCommunityIcons name="arrow-left" size={20} color={INK} />
          </Pressable>
          <View className="flex-1 justify-center">
            <Text className="text-3xl font-bold tracking-tight text-ink">Organizations</Text>
            {!loading && orgs.length > 0 ? (
              <Text className="mt-1 text-sm font-medium text-muted">
                {activeCount} active · {orgs.length - activeCount} inactive
              </Text>
            ) : null}
          </View>
          <SuperAdminRefreshButton
            onRefresh={handleRefresh}
            refreshing={refreshing}
            disabled={creating || togglingId != null}
          />
        </View>

        {/* List */}
        {loading && orgs.length === 0 ? (
          <View>
            {listHeader}
            <SkeletonList rows={5} label="Loading organizations" />
          </View>
        ) : (
          <FlatList
            data={orgs}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={SUPER_ADMIN_REFRESH_TINT}
                colors={[SUPER_ADMIN_REFRESH_TINT]}
              />
            }
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
