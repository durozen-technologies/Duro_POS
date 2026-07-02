import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { branding } from "@/constants/branding";
import { toApiError } from "@/api/client";
import {
  fetchOrganizationCounts,
  fetchOrganizationRows,
  type OrganizationRead,
} from "@/api/super-admin";
import type { AppStackParamList } from "@/navigation/types";
import { useAuthStore } from "@/store/auth-store";

import { SUPER_ADMIN_REFRESH_TINT, SuperAdminRefreshButton } from "./super-admin-refresh-button";

type Nav = NativeStackNavigationProp<AppStackParamList, "SuperAdminDashboard">;

const ACCENT = "#0F7642";
const MUTED = "#4B6356";

const NAV_TILES = [
  
  {
    route: "SuperAdminOrgs" as const,
    title: "Organizations",
    subtitle: "Create and manage tenant organizations",
    icon: "domain" as const,
    iconBg: "bg-surface",
    iconColor: MUTED,
  },
  {
    route: "SuperAdminAdmins" as const,
    title: "Tenant Admins",
    subtitle: "Manage admin accounts and permissions",
    icon: "account-cog-outline" as const,
    iconBg: "bg-surface",
    iconColor: MUTED,
  },
  {
    route: "SuperAdminBillingOverview" as const,
    title: "Billing Overview",
    subtitle: "Multi-tenant billing analytics across organizations",
    icon: "chart-bar" as const,
    iconBg: "bg-accentSoft",
    iconColor: ACCENT,
  },
  {
    route: "SuperAdminAudit" as const,
    title: "Audit Log",
    subtitle: "View system activity and security events",
    icon: "shield-check-outline" as const,
    iconBg: "bg-surface",
    iconColor: MUTED,
  },
] as const;

export function SuperAdminDashboardScreen() {
  const navigation = useNavigation<Nav>();
  const clearSession = useAuthStore((state) => state.clearSession);
  const user = useAuthStore((state) => state.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ active: number; all: number } | null>(null);
  const [recentOrgs, setRecentOrgs] = useState<OrganizationRead[]>([]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const [orgCounts, orgRows] = await Promise.all([
        fetchOrganizationCounts(),
        fetchOrganizationRows(),
      ]);
      setCounts(orgCounts);
      setRecentOrgs(orgRows.items.slice(0, 5));
    } catch (err) {
      setError(toApiError(err).message || "Failed to load dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View className="flex-1 bg-background">
      <View className="mx-auto w-full max-w-5xl flex-1">
        <ScrollView
          className="flex-1"
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
        >
          <View className="flex-row items-start justify-between px-4 pb-6 pt-10">
            <View>
              <Text className="text-xs font-semibold text-muted">
                {branding.appName} Control Panel
              </Text>
              <Text className="mt-1 text-2xl font-bold text-ink">
                Super Admin
              </Text>
              <Text className="mt-0.5 text-sm text-muted">
                Signed in as{" "}
                <Text className="font-semibold text-ink">{user?.username}</Text>
              </Text>
            </View>
            <View className="flex-row items-center gap-2">
              <SuperAdminRefreshButton
                onRefresh={handleRefresh}
                refreshing={refreshing}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign out"
                className="min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-border bg-card active:bg-dangerSoft active:border-dangerSoft"
                onPress={() => clearSession()}
              >
                <MaterialCommunityIcons name="logout" size={20} color={MUTED} />
              </Pressable>
            </View>
          </View>

          <View className="px-4">
            {loading ? (
              <View className="flex-row gap-3">
                {[0, 1, 2].map((i) => (
                  <View
                    key={i}
                    className="h-[80px] flex-1 rounded-card border border-border bg-surface"
                  />
                ))}
              </View>
            ) : counts ? (
              <View className="flex-row gap-3">
                <View className="flex-1 rounded-card border border-border bg-card px-4 pb-3 pt-3">
                  <Text className="text-xs font-medium text-muted">Total</Text>
                  <Text className="mt-1 text-2xl font-bold text-ink">
                    {counts.all}
                  </Text>
                  <Text className="text-xs text-muted">orgs</Text>
                </View>
                <View className="flex-1 rounded-card border border-success bg-successSoft px-4 pb-3 pt-3">
                  <Text className="text-xs font-medium text-success">Active</Text>
                  <Text className="mt-1 text-2xl font-bold text-success">
                    {counts.active}
                  </Text>
                  <Text className="text-xs text-success">orgs</Text>
                </View>
                <View className="flex-1 rounded-card border border-border bg-card px-4 pb-3 pt-3">
                  <Text className="text-xs font-medium text-muted">Inactive</Text>
                  <Text className="mt-1 text-2xl font-bold text-ink">
                    {counts.all - counts.active}
                  </Text>
                  <Text className="text-xs text-muted">orgs</Text>
                </View>
              </View>
            ) : null}

            {error ? (
              <View className="mt-3 rounded-control border border-dangerSoft bg-dangerSoft px-4 py-3">
                <Text className="text-sm text-danger">{error}</Text>
              </View>
            ) : null}
          </View>

          <View className="mt-6 px-4">
            <Text className="mb-3 text-xs font-semibold text-muted">
              Management
            </Text>
            <View className="rounded-card border border-border bg-card">
              {NAV_TILES.map((tile, index) => (
                <Pressable
                  key={tile.route}
                  accessibilityRole="button"
                  className={`flex-row items-center gap-4 px-4 py-4 active:bg-surface ${index < NAV_TILES.length - 1 ? "border-b border-border" : ""}`}
                  onPress={() => navigation.navigate(tile.route)}
                >
                  <View
                    className={`h-10 w-10 items-center justify-center rounded-control ${tile.iconBg}`}
                  >
                    <MaterialCommunityIcons
                      name={tile.icon}
                      size={20}
                      color={tile.iconColor}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="font-semibold text-ink">{tile.title}</Text>
                    <Text className="mt-0.5 text-xs text-muted">
                      {tile.subtitle}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={20}
                    color={MUTED}
                  />
                </Pressable>
              ))}
            </View>
          </View>

          {!loading && recentOrgs.length > 0 ? (
            <View className="mt-6 px-4">
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-muted">
                  Recent Organizations
                </Text>
                <Pressable
                  accessibilityRole="button"
                  className="active:opacity-80"
                  onPress={() => navigation.navigate("SuperAdminOrgs")}
                >
                  <Text className="text-xs font-semibold text-accent">
                    View all
                  </Text>
                </Pressable>
              </View>
              <View className="rounded-card border border-border bg-card">
                {recentOrgs.map((org, index) => (
                  <View
                    key={org.id}
                    className={`flex-row items-center px-4 py-3 ${index < recentOrgs.length - 1 ? "border-b border-border" : ""}`}
                  >
                    <View
                      className={`mr-3 h-2 w-2 rounded-full ${org.is_active ? "bg-success" : "bg-border"}`}
                    />
                    <View className="flex-1">
                      <Text
                        className="text-sm font-medium text-ink"
                        numberOfLines={1}
                      >
                        {org.name}
                      </Text>
                      <Text className="text-xs text-muted">{org.slug}</Text>
                    </View>
                    <View
                      className={`rounded-full px-2 py-0.5 ${org.is_active ? "bg-successSoft" : "bg-surface"}`}
                    >
                      <Text
                        className={`text-xs font-semibold ${org.is_active ? "text-success" : "text-muted"}`}
                      >
                        {org.is_active ? "Active" : "Inactive"}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}
