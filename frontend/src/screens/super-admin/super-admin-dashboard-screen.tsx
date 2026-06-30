import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { toApiError } from "@/api/client";
import {
  createOrganization,
  fetchAuditLogRows,
  fetchOrganizationCounts,
  fetchOrganizationRows,
  patchOrganizationStatus,
  type AuditLogRead,
  type OrganizationRead,
} from "@/api/super-admin";
import { useAuthStore } from "@/store/auth-store";

import { TenantAdminsTab } from "./tenant-admins-tab";

type Tab = "orgs" | "admins" | "audit";

export function SuperAdminDashboardScreen() {
  const clearSession = useAuthStore((state) => state.clearSession);
  const user = useAuthStore((state) => state.user);
  const [tab, setTab] = useState<Tab>("orgs");
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<OrganizationRead[]>([]);
  const [audit, setAudit] = useState<AuditLogRead[]>([]);
  const [counts, setCounts] = useState("");
  const [newOrgName, setNewOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [orgRows, auditRows, orgCounts] = await Promise.all([
        fetchOrganizationRows(),
        fetchAuditLogRows(),
        fetchOrganizationCounts(),
      ]);
      setOrgs(orgRows.items);
      setAudit(auditRows.items);
      setCounts(`${orgCounts.active}/${orgCounts.all} orgs active`);
    } catch (loadError) {
      setError(toApiError(loadError).message || "Failed to load super admin data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateOrg = async () => {
    const name = newOrgName.trim();
    if (!name) return;
    setError(null);
    try {
      await createOrganization({ name });
      setNewOrgName("");
      await load();
    } catch (createError) {
      setError(toApiError(createError).message || "Failed to create organization");
    }
  };

  const toggleOrgStatus = async (org: OrganizationRead) => {
    setError(null);
    try {
      await patchOrganizationStatus(org.id, !org.is_active);
      await load();
    } catch (toggleError) {
      setError(toApiError(toggleError).message || "Failed to update organization");
    }
  };

  return (
    <View className="flex-1 bg-neutral-100">
      <View className="px-4 pt-6">
        <Text className="text-2xl font-semibold text-neutral-900">Duro POS Super Admin</Text>
        <Text className="mt-1 text-sm text-neutral-600">{user?.username}</Text>
        <Text className="mt-1 text-sm text-neutral-600">{counts}</Text>

        <View className="mt-4 flex-row gap-2">
          {(["orgs", "admins", "audit"] as Tab[]).map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              className={`rounded-lg px-3 py-2 ${tab === key ? "bg-neutral-900" : "bg-white"}`}
              onPress={() => setTab(key)}
            >
              <Text className={tab === key ? "font-medium text-white" : "text-neutral-700"}>
                {key === "orgs" ? "Organizations" : key === "admins" ? "Tenant Admins" : "Audit"}
              </Text>
            </Pressable>
          ))}
        </View>

        {error && tab !== "admins" ? (
          <Text className="mt-3 text-sm text-red-600">{error}</Text>
        ) : null}
      </View>

      {tab === "admins" ? (
        <View className="flex-1 px-4">
          <TenantAdminsTab orgs={orgs} />
        </View>
      ) : (
        <ScrollView className="flex-1 px-4" keyboardShouldPersistTaps="handled">
          {loading ? <ActivityIndicator className="mt-6" /> : null}

          {tab === "orgs" && !loading ? (
            <View className="mt-4">
              <Text className="text-lg font-semibold text-neutral-900">Create organization</Text>
              <TextInput
                className="mt-2 rounded-lg border border-neutral-300 bg-white px-3 py-2"
                placeholder="Organization name"
                value={newOrgName}
                onChangeText={setNewOrgName}
              />
              <Pressable
                accessibilityRole="button"
                className="mt-2 items-center rounded-lg bg-neutral-900 px-4 py-2"
                onPress={() => void handleCreateOrg()}
              >
                <Text className="font-medium text-white">Create</Text>
              </Pressable>

              {orgs.map((org) => (
                <View key={org.id} className="mt-3 rounded-lg bg-white p-3">
                  <Text className="font-medium text-neutral-900">{org.name}</Text>
                  <Text className="text-sm text-neutral-600">{org.slug}</Text>
                  <Pressable
                    accessibilityRole="button"
                    className="mt-2 self-start rounded bg-neutral-200 px-2 py-1"
                    onPress={() => void toggleOrgStatus(org)}
                  >
                    <Text className="text-xs text-neutral-800">
                      {org.is_active ? "Disable" : "Enable"}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {tab === "audit" && !loading
            ? audit.map((entry) => (
                <View key={entry.id} className="mt-3 rounded-lg bg-white p-3">
                  <Text className="font-medium text-neutral-900">{entry.action}</Text>
                  <Text className="text-sm text-neutral-600">{entry.entity_type}</Text>
                  <Text className="text-xs text-neutral-500">{entry.created_at}</Text>
                </View>
              ))
            : null}

          <Pressable
            accessibilityRole="button"
            className="mt-8 items-center rounded-lg bg-red-600 px-4 py-3"
            onPress={() => clearSession()}
          >
            <Text className="font-semibold text-white">Sign out</Text>
          </Pressable>
        </ScrollView>
      )}

      {tab === "admins" ? (
        <Pressable
          accessibilityRole="button"
          className="mx-4 mb-6 mt-2 items-center rounded-lg bg-red-600 px-4 py-3"
          onPress={() => clearSession()}
        >
          <Text className="font-semibold text-white">Sign out</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
