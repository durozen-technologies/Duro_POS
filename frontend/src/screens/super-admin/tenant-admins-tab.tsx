import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import type { OrganizationRead, TenantAdminRead } from "@/api/super-admin";

import { TenantAdminManageSheet } from "./tenant-admin-manage-sheet";
import {
  useTenantAdminsData,
  type TenantAdminStatusFilter,
} from "./use-tenant-admins-data";

type TenantAdminsTabProps = {
  orgs: OrganizationRead[];
};

function formatLastLogin(value?: string | null) {
  if (!value) return "Never logged in";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function TenantAdminsTab({ orgs }: TenantAdminsTabProps) {
  const {
    admins,
    counts,
    loading,
    loadingMore,
    creating,
    error,
    setError,
    organizationFilter,
    setOrganizationFilter,
    statusFilter,
    setStatusFilter,
    search,
    setSearch,
    selectedOrgId,
    setSelectedOrgId,
    loadMore,
    createAdmin,
    setAdminStatus,
    resetPassword,
    setRoles,
    removeAdmin,
    loadOrgRoles,
  } = useTenantAdminsData(orgs);

  const [newAdminUsername, setNewAdminUsername] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [managedAdmin, setManagedAdmin] = useState<TenantAdminRead | null>(
    null,
  );
  const [sheetRoles, setSheetRoles] = useState<
    Awaited<ReturnType<typeof loadOrgRoles>>
  >([]);
  const [loadingRoles, setLoadingRoles] = useState(false);

  const activeOrgs = orgs.filter((org) => org.is_active);

  const openManageSheet = useCallback(
    async (admin: TenantAdminRead) => {
      setManagedAdmin(admin);
      setLoadingRoles(true);
      try {
        const roles = await loadOrgRoles(admin.organization_id);
        setSheetRoles(roles);
      } catch {
        setSheetRoles([]);
      } finally {
        setLoadingRoles(false);
      }
    },
    [loadOrgRoles],
  );

  const handleCreate = async () => {
    const username = newAdminUsername.trim();
    if (!selectedOrgId) {
      setError("Please select an organization to add this admin.");
      return;
    }
    if (username.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }
    if (newAdminPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    try {
      await createAdmin(username, newAdminPassword, selectedOrgId);
      setNewAdminUsername("");
      setNewAdminPassword("");
    } catch {
      // error state set in hook
    }
  };

  const renderAdminItem = useCallback(
    ({ item }: { item: TenantAdminRead }) => (
      <Pressable
        accessibilityRole="button"
        className="mt-3 rounded-card border border-border bg-card p-4 shadow-sm active:opacity-80"
        onPress={() => void openManageSheet(item)}
      >
        <Text className="font-medium text-ink">{item.username}</Text>
        <Text className="mt-1 text-sm text-muted">
          {item.organization_name}
        </Text>
        <Text className="mt-1 text-xs text-muted">
          {item.is_active ? "Active" : "Disabled"} ·{" "}
          {formatLastLogin(item.last_login_at)}
        </Text>
      </Pressable>
    ),
    [openManageSheet],
  );

  const renderStatusChip = (key: TenantAdminStatusFilter, label: string) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected: statusFilter === key }}
      className={`min-h-[44px] items-center justify-center rounded-control border px-4 py-2 active:opacity-80 ${statusFilter === key ? "border-transparent bg-accent" : "border-border bg-card"}`}
      onPress={() => setStatusFilter(key)}
    >
      <Text
        className={
          statusFilter === key
            ? "font-medium text-white"
            : "font-medium text-ink"
        }
      >
        {label}
      </Text>
    </Pressable>
  );

  const listHeader = (
    <View>
      <Text className="text-lg font-semibold text-ink">Tenant admins</Text>
      <Text className="mt-1 text-sm text-muted">
        {counts ? `${counts.active}/${counts.all} active` : "Loading counts..."}
      </Text>

      <Text className="mt-4 text-sm font-medium text-ink">
        Filter by organization
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mt-2"
        contentContainerStyle={{ gap: 8, paddingRight: 16 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: organizationFilter === "all" }}
          className={`min-h-[44px] items-center justify-center rounded-control border px-4 py-2 active:opacity-80 ${organizationFilter === "all" ? "border-transparent bg-accent" : "border-border bg-card"}`}
          onPress={() => setOrganizationFilter("all")}
        >
          <Text
            className={
              organizationFilter === "all"
                ? "font-medium text-white"
                : "font-medium text-ink"
            }
          >
            All
          </Text>
        </Pressable>
        {activeOrgs.map((org) => (
          <Pressable
            key={org.id}
            accessibilityRole="button"
            accessibilityState={{ selected: organizationFilter === org.id }}
            className={`min-h-[44px] items-center justify-center rounded-control border px-4 py-2 active:opacity-80 ${
              organizationFilter === org.id
                ? "border-transparent bg-accent"
                : "border-border bg-card"
            }`}
            onPress={() => setOrganizationFilter(org.id)}
          >
            <Text
              className={
                organizationFilter === org.id
                  ? "font-medium text-white"
                  : "font-medium text-ink"
              }
            >
              {org.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <TextInput
        accessibilityLabel="Search tenant admins"
        autoCapitalize="none"
        autoCorrect={false}
        className="mt-3 min-h-[44px] rounded-control border border-border bg-card px-4 py-2"
        placeholder="Search by username"
        value={search}
        onChangeText={setSearch}
      />

      <View className="mt-2 flex-row flex-wrap gap-2">
        {renderStatusChip("all", "All")}
        {renderStatusChip("active", "Active")}
        {renderStatusChip("disabled", "Disabled")}
      </View>

      <Text className="mt-8 text-lg font-semibold text-ink">
        Add Tenant Admin
      </Text>
      {activeOrgs.length === 0 ? (
        <Text className="mt-2 text-sm text-warning">
          Create an active organization on the Organizations tab first.
        </Text>
      ) : (
        <>
          <Text className="mt-2 text-sm font-medium text-ink">
            Organization
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mt-2"
            contentContainerStyle={{ gap: 8, paddingRight: 16 }}
          >
            {activeOrgs.map((org) => (
              <Pressable
                key={org.id}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedOrgId === org.id }}
                className={`min-h-[44px] items-center justify-center rounded-control border px-4 py-2 active:opacity-80 ${selectedOrgId === org.id ? "border-transparent bg-accent" : "border-border bg-card"}`}
                onPress={() => setSelectedOrgId(org.id)}
              >
                <Text
                  className={
                    selectedOrgId === org.id
                      ? "font-medium text-white"
                      : "font-medium text-ink"
                  }
                >
                  {org.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="mt-3 min-h-[44px] rounded-control border border-border bg-card px-4 py-2"
            placeholder="Username"
            value={newAdminUsername}
            onChangeText={setNewAdminUsername}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="mt-2 min-h-[44px] rounded-control border border-border bg-card px-4 py-2"
            placeholder="Password (8+ characters)"
            secureTextEntry
            value={newAdminPassword}
            onChangeText={setNewAdminPassword}
          />
          <Pressable
            accessibilityRole="button"
            className={`mt-3 min-h-[44px] items-center justify-center rounded-control px-4 py-2 shadow-sm ${
              creating ? "bg-muted opacity-50" : "bg-accent active:opacity-80"
            }`}
            disabled={creating}
            onPress={() => void handleCreate()}
          >
            {creating ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="font-medium text-white">Add Admin</Text>
            )}
          </Pressable>
        </>
      )}

      {error ? <Text className="mt-3 text-sm text-danger">{error}</Text> : null}
      <Text className="mt-6 text-sm font-medium text-ink">
        All tenant admins
      </Text>
    </View>
  );

  return (
    <View className="flex-1">
      {loading && admins.length === 0 ? (
        <View className="mt-6">
          {listHeader}
          <ActivityIndicator className="mt-4" />
        </View>
      ) : (
        <FlatList
          data={admins}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text className="mt-3 text-sm text-muted">
              No tenant admins found matching your criteria.
            </Text>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator className="mt-4" /> : null
          }
          ListHeaderComponent={listHeader}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          initialNumToRender={20}
          maxToRenderPerBatch={10}
          windowSize={5}
          renderItem={renderAdminItem}
        />
      )}

      <TenantAdminManageSheet
        admin={managedAdmin}
        loadingRoles={loadingRoles}
        roles={sheetRoles}
        visible={managedAdmin != null}
        onClose={() => setManagedAdmin(null)}
        onDelete={removeAdmin}
        onResetPassword={(admin, password) => resetPassword(admin.id, password)}
        onToggleStatus={(admin, nextActive) =>
          setAdminStatus(admin.id, nextActive)
        }
        onUpdateRoles={(admin, roleIds) => setRoles(admin.id, roleIds)}
      />
    </View>
  );
}
