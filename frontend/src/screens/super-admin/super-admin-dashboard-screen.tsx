import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
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
import type { UUID } from "@/types/api";
import { useAuthStore } from "@/store/auth-store";

import { TenantAdminsTab } from "./tenant-admins-tab";

type Tab = "orgs" | "admins" | "audit";

const AUDIT_PAGE_SIZE = 50;

function formatTimestamp(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

const TAB_LABELS: Record<Tab, string> = {
  orgs: "Organizations",
  admins: "Tenant Admins",
  audit: "Audit Log",
};

export function SuperAdminDashboardScreen() {
  const clearSession = useAuthStore((state) => state.clearSession);
  const user = useAuthStore((state) => state.user);
  const [tab, setTab] = useState<Tab>("orgs");
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<OrganizationRead[]>([]);
  const [audit, setAudit] = useState<AuditLogRead[]>([]);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);
  const auditCursorRef = useRef<{ created_at: string; id: UUID } | null>(null);
  const [orgCounts, setOrgCounts] = useState<{
    active: number;
    all: number;
  } | null>(null);
  const [newOrgName, setNewOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [orgRows, auditRows, counts] = await Promise.all([
        fetchOrganizationRows(),
        fetchAuditLogRows({ limit: AUDIT_PAGE_SIZE }),
        fetchOrganizationCounts(),
      ]);
      setOrgs(orgRows.items);
      setAudit(auditRows.items);
      setAuditHasMore(auditRows.has_more);
      auditCursorRef.current =
        auditRows.has_more &&
        auditRows.next_cursor_created_at &&
        auditRows.next_cursor_id
          ? {
              created_at: auditRows.next_cursor_created_at,
              id: auditRows.next_cursor_id,
            }
          : null;
      setOrgCounts(counts);
    } catch (loadError) {
      setError(
        toApiError(loadError).message || "Failed to load super admin data",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMoreAudit = useCallback(async () => {
    const cursor = auditCursorRef.current;
    if (!auditHasMore || auditLoadingMore || !cursor) return;
    setAuditLoadingMore(true);
    setError(null);
    try {
      const page = await fetchAuditLogRows({
        limit: AUDIT_PAGE_SIZE,
        cursor_created_at: cursor.created_at,
        cursor_id: cursor.id,
      });
      setAudit((current) => [...current, ...page.items]);
      setAuditHasMore(page.has_more);
      auditCursorRef.current =
        page.has_more && page.next_cursor_created_at && page.next_cursor_id
          ? {
              created_at: page.next_cursor_created_at,
              id: page.next_cursor_id,
            }
          : null;
    } catch (loadError) {
      setError(
        toApiError(loadError).message || "Failed to load more audit logs",
      );
    } finally {
      setAuditLoadingMore(false);
    }
  }, [auditHasMore, auditLoadingMore]);

  useEffect(() => {
    void load();
  }, [load]);

  const renderAuditItem = useCallback(
    ({ item }: { item: AuditLogRead }) => (
      <View className="mt-2 border-b border-border px-1 py-3">
        <View className="flex-row items-center justify-between">
          <Text className="flex-1 font-medium text-ink" numberOfLines={1}>
            {item.action}
          </Text>
          <Text className="ml-3 text-xs text-muted">
            {formatTimestamp(item.created_at)}
          </Text>
        </View>
        <Text className="mt-0.5 text-sm text-muted">{item.entity_type}</Text>
      </View>
    ),
    [],
  );

  const handleCreateOrg = async () => {
    const name = newOrgName.trim();
    if (!name) return;
    setError(null);
    try {
      await createOrganization({ name });
      setNewOrgName("");
      await load();
    } catch (createError) {
      setError(
        toApiError(createError).message || "Failed to create organization",
      );
    }
  };

  const toggleOrgStatus = async (org: OrganizationRead) => {
    setError(null);
    try {
      await patchOrganizationStatus(org.id, !org.is_active);
      await load();
    } catch (toggleError) {
      setError(
        toApiError(toggleError).message || "Failed to update organization",
      );
    }
  };

  return (
    <View className="flex-1 bg-background">
      <View className="mx-auto w-full max-w-5xl flex-1">
        {/* Header */}
        <View className="px-4 pt-8">
          <Text className="text-3xl font-bold tracking-tight text-ink">
            Super Admin
          </Text>
          <Text className="mt-1 text-base text-muted">
            {user?.username}
          </Text>

          {/* Org stats */}
          {orgCounts ? (
            <View className="mt-6 flex-row gap-3">
              <View className="flex-1 rounded-card border border-border bg-card p-4">
                <Text className="text-xs font-medium uppercase tracking-wide text-muted">
                  Total
                </Text>
                <Text className="mt-1 text-2xl font-semibold text-ink">
                  {orgCounts.all}
                </Text>
                <Text className="mt-0.5 text-xs text-muted">organizations</Text>
              </View>
              <View className="flex-1 rounded-card border border-border bg-card p-4">
                <Text className="text-xs font-medium uppercase tracking-wide text-muted">
                  Active
                </Text>
                <Text className="mt-1 text-2xl font-semibold text-accent">
                  {orgCounts.active}
                </Text>
                <Text className="mt-0.5 text-xs text-muted">organizations</Text>
              </View>
              <View className="flex-1 rounded-card border border-border bg-card p-4">
                <Text className="text-xs font-medium uppercase tracking-wide text-muted">
                  Inactive
                </Text>
                <Text className="mt-1 text-2xl font-semibold text-ink">
                  {orgCounts.all - orgCounts.active}
                </Text>
                <Text className="mt-0.5 text-xs text-muted">organizations</Text>
              </View>
            </View>
          ) : loading ? (
            <View className="mt-6 flex-row gap-3">
              {[0, 1, 2].map((i) => (
                <View
                  key={i}
                  className="h-20 flex-1 rounded-card border border-border bg-surface"
                />
              ))}
            </View>
          ) : null}

          {/* Tab bar */}
          <View className="mt-6 flex-row gap-2">
            {(["orgs", "admins", "audit"] as Tab[]).map((key) => (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === key }}
                className={`min-h-[44px] flex-1 items-center justify-center rounded-control border px-3 py-2 active:opacity-80 ${tab === key ? "border-transparent bg-accent" : "border-border bg-card"}`}
                onPress={() => setTab(key)}
              >
                <Text
                  className={
                    tab === key
                      ? "text-sm font-semibold text-white"
                      : "text-sm font-medium text-ink"
                  }
                >
                  {TAB_LABELS[key]}
                </Text>
              </Pressable>
            ))}
          </View>

          {error && tab !== "admins" ? (
            <View className="mt-3 rounded-control border border-dangerSoft bg-dangerSoft px-4 py-3">
              <Text className="text-sm text-danger">{error}</Text>
            </View>
          ) : null}
        </View>

        {/* Tab content */}
        {tab === "admins" ? (
          <View className="flex-1 px-4">
            <TenantAdminsTab orgs={orgs} />
          </View>
        ) : tab === "audit" ? (
          <View className="flex-1 px-4">
            {loading && audit.length === 0 ? (
              <ActivityIndicator className="mt-6" />
            ) : (
              <FlatList
                data={audit}
                keyExtractor={(item) => item.id}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 24 }}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  <Text className="mt-8 text-center text-sm text-muted">
                    No audit entries yet.
                  </Text>
                }
                ListFooterComponent={
                  auditLoadingMore ? (
                    <ActivityIndicator className="mt-4" />
                  ) : auditHasMore ? (
                    <Pressable
                      accessibilityRole="button"
                      className="mt-4 min-h-[44px] items-center justify-center rounded-control border border-border bg-card px-4 py-3 active:opacity-80"
                      onPress={() => void loadMoreAudit()}
                    >
                      <Text className="text-sm font-medium text-ink">
                        Load more
                      </Text>
                    </Pressable>
                  ) : null
                }
                ListHeaderComponent={
                  <Text className="mt-4 text-base font-semibold text-ink">
                    Audit Log
                  </Text>
                }
                onEndReached={() => void loadMoreAudit()}
                onEndReachedThreshold={0.4}
                initialNumToRender={20}
                maxToRenderPerBatch={10}
                windowSize={5}
                renderItem={renderAuditItem}
              />
            )}
          </View>
        ) : (
          <ScrollView
            className="flex-1 px-4"
            keyboardShouldPersistTaps="handled"
          >
            {loading ? <ActivityIndicator className="mt-6" /> : null}

            {tab === "orgs" && !loading ? (
              <View className="mt-4">
                <Text className="text-base font-semibold text-ink">
                  Create Organization
                </Text>
                <View className="mt-3 flex-row gap-2">
                  <TextInput
                    accessibilityLabel="Organization name"
                    className="min-h-[44px] flex-1 rounded-control border border-border bg-card px-4 py-2 text-ink"
                    placeholder="Organization name"
                    placeholderTextColor="#4B6356"
                    returnKeyType="done"
                    value={newOrgName}
                    onChangeText={setNewOrgName}
                    onSubmitEditing={() => void handleCreateOrg()}
                  />
                  <Pressable
                    accessibilityRole="button"
                    className="min-h-[44px] items-center justify-center rounded-control bg-accent px-5 active:opacity-80"
                    onPress={() => void handleCreateOrg()}
                  >
                    <Text className="text-sm font-semibold text-white">
                      Create
                    </Text>
                  </Pressable>
                </View>

                {orgs.length > 0 ? (
                  <View className="mt-6">
                    <Text className="mb-3 text-base font-semibold text-ink">
                      All Organizations
                    </Text>
                    {orgs.map((org) => (
                      <View
                        key={org.id}
                        className="mb-2 flex-row items-center justify-between rounded-card border border-border bg-card px-4 py-3"
                      >
                        <View className="flex-1 pr-3">
                          <View className="flex-row items-center gap-2">
                            <Text className="font-medium text-ink">
                              {org.name}
                            </Text>
                            <View
                              className={`rounded-full px-2 py-0.5 ${org.is_active ? "bg-successSoft" : "bg-surface"}`}
                            >
                              <Text
                                className={`text-xs font-medium ${org.is_active ? "text-success" : "text-muted"}`}
                              >
                                {org.is_active ? "Active" : "Inactive"}
                              </Text>
                            </View>
                          </View>
                          <Text className="mt-0.5 text-sm text-muted">
                            {org.slug}
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={
                            org.is_active
                              ? `Disable ${org.name}`
                              : `Enable ${org.name}`
                          }
                          className={`min-h-[44px] min-w-[80px] items-center justify-center rounded-control border px-3 active:opacity-80 ${org.is_active ? "border-border bg-card" : "border-transparent bg-accent"}`}
                          onPress={() => void toggleOrgStatus(org)}
                        >
                          <Text
                            className={`text-sm font-medium ${org.is_active ? "text-ink" : "text-white"}`}
                          >
                            {org.is_active ? "Disable" : "Enable"}
                          </Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Spacer */}
            <View className="h-6" />
          </ScrollView>
        )}

        {/* Single sign-out, always at bottom */}
        <Pressable
          accessibilityRole="button"
          className="mx-4 mb-6 mt-2 min-h-[44px] items-center justify-center rounded-control bg-danger px-4 py-3 active:opacity-80"
          onPress={() => clearSession()}
        >
          <Text className="text-sm font-semibold text-white">Sign Out</Text>
        </Pressable>
      </View>
    </View>
  );
}
