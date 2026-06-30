import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import type { OrganizationRead, TenantAdminRead } from "@/api/super-admin";
import type { UUID } from "@/types/api";

import { TenantAdminManageSheet } from "./tenant-admin-manage-sheet";
import {
  useTenantAdminsData,
  type TenantAdminStatusFilter,
} from "./use-tenant-admins-data";

type TenantAdminsTabProps = {
  orgs: OrganizationRead[];
};

function formatLastLogin(value?: string | null) {
  if (!value) return "No logins yet";
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
    hasMore,
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
  const [managedAdmin, setManagedAdmin] = useState<TenantAdminRead | null>(null);
  const [sheetRoles, setSheetRoles] = useState<Awaited<ReturnType<typeof loadOrgRoles>>>([]);
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
      setError("Create or select an active organization first.");
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

  const renderStatusChip = (key: TenantAdminStatusFilter, label: string) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected: statusFilter === key }}
      className={`rounded-lg px-3 py-2 ${statusFilter === key ? "bg-neutral-900" : "bg-white"}`}
      onPress={() => setStatusFilter(key)}
    >
      <Text className={statusFilter === key ? "font-medium text-white" : "text-neutral-700"}>
        {label}
      </Text>
    </Pressable>
  );

  const listHeader = (
    <View>
      <Text className="text-lg font-semibold text-neutral-900">Tenant admins</Text>
      <Text className="mt-1 text-sm text-neutral-600">
        {counts ? `${counts.active}/${counts.all} active` : "Loading counts..."}
      </Text>

      <Text className="mt-4 text-sm font-medium text-neutral-700">Filter by organization</Text>
      <View className="mt-2 flex-row flex-wrap gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: organizationFilter === "all" }}
          className={`rounded-lg px-3 py-2 ${organizationFilter === "all" ? "bg-neutral-900" : "bg-white"}`}
          onPress={() => setOrganizationFilter("all")}
        >
          <Text
            className={
              organizationFilter === "all" ? "font-medium text-white" : "text-neutral-700"
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
            className={`rounded-lg px-3 py-2 ${
              organizationFilter === org.id ? "bg-neutral-900" : "bg-white"
            }`}
            onPress={() => setOrganizationFilter(org.id)}
          >
            <Text
              className={
                organizationFilter === org.id ? "font-medium text-white" : "text-neutral-700"
              }
            >
              {org.name}
            </Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        accessibilityLabel="Search tenant admins"
        autoCapitalize="none"
        autoCorrect={false}
        className="mt-3 rounded-lg border border-neutral-300 bg-white px-3 py-2"
        placeholder="Search by username"
        value={search}
        onChangeText={setSearch}
      />

      <View className="mt-2 flex-row flex-wrap gap-2">
        {renderStatusChip("all", "All")}
        {renderStatusChip("active", "Active")}
        {renderStatusChip("disabled", "Disabled")}
      </View>

      <Text className="mt-6 text-lg font-semibold text-neutral-900">Create tenant admin</Text>
      {activeOrgs.length === 0 ? (
        <Text className="mt-2 text-sm text-amber-700">
          Create an active organization on the Organizations tab first.
        </Text>
      ) : (
        <>
          <Text className="mt-2 text-sm font-medium text-neutral-700">Organization</Text>
          <View className="mt-2 flex-row flex-wrap gap-2">
            {activeOrgs.map((org) => (
              <Pressable
                key={org.id}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedOrgId === org.id }}
                className={`rounded-lg px-3 py-2 ${selectedOrgId === org.id ? "bg-neutral-900" : "bg-white"}`}
                onPress={() => setSelectedOrgId(org.id)}
              >
                <Text
                  className={
                    selectedOrgId === org.id ? "font-medium text-white" : "text-neutral-700"
                  }
                >
                  {org.name}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="mt-3 rounded-lg border border-neutral-300 bg-white px-3 py-2"
            placeholder="Username"
            value={newAdminUsername}
            onChangeText={setNewAdminUsername}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="mt-2 rounded-lg border border-neutral-300 bg-white px-3 py-2"
            placeholder="Password (min 8 characters)"
            secureTextEntry
            value={newAdminPassword}
            onChangeText={setNewAdminPassword}
          />
          <Pressable
            accessibilityRole="button"
            className={`mt-2 items-center rounded-lg px-4 py-2 ${
              creating ? "bg-neutral-500" : "bg-neutral-900"
            }`}
            disabled={creating}
            onPress={() => void handleCreate()}
          >
            {creating ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="font-medium text-white">Create tenant admin</Text>
            )}
          </Pressable>
        </>
      )}

      {error ? <Text className="mt-3 text-sm text-red-600">{error}</Text> : null}
      <Text className="mt-6 text-sm font-medium text-neutral-700">All tenant admins</Text>
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
            <Text className="mt-3 text-sm text-neutral-600">No tenant admins match these filters.</Text>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator className="mt-4" /> : null
          }
          ListHeaderComponent={listHeader}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              className="mt-3 rounded-lg bg-white p-3"
              onPress={() => void openManageSheet(item)}
            >
              <Text className="font-medium text-neutral-900">{item.username}</Text>
              <Text className="text-sm text-neutral-600">{item.organization_name}</Text>
              <Text className="text-xs text-neutral-500">
                {item.is_active ? "Active" : "Disabled"} · {formatLastLogin(item.last_login_at)}
              </Text>
            </Pressable>
          )}
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
        onToggleStatus={(admin, nextActive) => setAdminStatus(admin.id, nextActive)}
        onUpdateRoles={(admin, roleIds) => setRoles(admin.id, roleIds)}
      />
    </View>
  );
}
