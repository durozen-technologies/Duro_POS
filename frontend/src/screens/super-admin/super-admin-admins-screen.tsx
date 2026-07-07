import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useState } from "react";
import { SkeletonList } from "@/components/ui/skeleton";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import {
  fetchOrganizationRows,
  type OrganizationRead,
  type TenantAdminRead,
} from "@/api/super-admin";
import type { AppStackParamList } from "@/navigation/types";
import { formatDateTime } from "@/utils/format";

import { TenantAdminManageSheet } from "./tenant-admin-manage-sheet";
import { SUPER_ADMIN_REFRESH_TINT, SuperAdminRefreshButton } from "./super-admin-refresh-button";
import {
  useTenantAdminsData,
  type TenantAdminStatusFilter,
} from "./use-tenant-admins-data";

type Nav = NativeStackNavigationProp<AppStackParamList, "SuperAdminAdmins">;

const INK = "#0A110D";
const MUTED = "#4B6356";
const ACCENT = "#0F7642";

function formatLastLogin(value?: string | null) {
  if (!value) return "Never logged in";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDateTime(value);
}

// ── Design primitives ────────────────────────────────────────────────────────

const StatusBadge = memo(function StatusBadge({ active }: { active: boolean }) {
  return (
    <View
      className={`rounded-full px-2.5 py-1 ${active ? "bg-successSoft" : "bg-surface"}`}
    >
      <Text
        className={`text-xs font-semibold ${active ? "text-success" : "text-muted"}`}
      >
        {active ? "Active" : "Disabled"}
      </Text>
    </View>
  );
});

/** Radio row inside the dropdown sheet */
function RadioRow({
  label,
  sublabel,
  selected,
  onPress,
}: {
  label: string;
  sublabel?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      className="min-h-[52px] flex-row items-center gap-4 border-b border-border px-5 active:bg-surface"
      onPress={onPress}
    >
      {/* Radio circle */}
      <View
        className={`h-5 w-5 items-center justify-center rounded-full border-2 ${selected ? "border-accent" : "border-border"}`}
      >
        {selected ? (
          <View className="h-2.5 w-2.5 rounded-full bg-accent" />
        ) : null}
      </View>
      <View className="flex-1">
        <Text
          className={`text-sm ${selected ? "font-semibold text-ink" : "font-medium text-ink"}`}
        >
          {label}
        </Text>
        {sublabel ? (
          <Text className="text-xs text-muted">{sublabel}</Text>
        ) : null}
      </View>
      {selected ? (
        <MaterialCommunityIcons name="check" size={16} color={ACCENT} />
      ) : null}
    </Pressable>
  );
}

type DropdownOption<T extends string> = {
  value: T;
  label: string;
  sublabel?: string;
};

/**
 * SelectDropdown — a compact trigger that opens a radio-list bottom sheet.
 * Works for any string union via generic T.
 */
function SelectDropdown<T extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: DropdownOption<T>[];
  value: T;
  onSelect: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <>
      {/* Trigger */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? value}`}
        className="flex-1 flex-row items-center justify-between rounded-control border border-border bg-card px-3 py-2 active:bg-surface"
        style={{ minHeight: 44 }}
        onPress={() => setOpen(true)}
      >
        <View className="mr-2 flex-1">
          <Text className="text-xs text-muted">{label}</Text>
          <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
            {selected?.label ?? value}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-down" size={18} color={MUTED} />
      </Pressable>

      {/* Bottom sheet modal */}
      <Modal
        visible={open}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1 justify-end bg-black/50"
        >
          {/* Backdrop tap to close */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="flex-1"
            onPress={() => setOpen(false)}
          />

          {/* Sheet */}
          <View className="rounded-t-2xl bg-card pb-10">
            {/* Drag handle */}
            <View className="items-center pt-3 pb-2">
              <View className="h-1 w-10 rounded-full bg-border" />
            </View>

            {/* Sheet title */}
            <View className="flex-row items-center justify-between border-b border-border px-5 pb-3">
              <Text className="text-base font-semibold text-ink">{label}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                className="min-h-[44px] min-w-[44px] items-center justify-center active:opacity-80"
                onPress={() => setOpen(false)}
              >
                <MaterialCommunityIcons name="close" size={20} color={INK} />
              </Pressable>
            </View>

            {/* Radio options */}
            {options.map((opt) => (
              <RadioRow
                key={opt.value}
                label={opt.label}
                sublabel={opt.sublabel}
                selected={value === opt.value}
                onPress={() => {
                  onSelect(opt.value);
                  setOpen(false);
                }}
              />
            ))}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export function SuperAdminAdminsScreen() {
  const navigation = useNavigation<Nav>();

  const [orgs, setOrgs] = useState<OrganizationRead[]>([]);
  const [orgsRefreshing, setOrgsRefreshing] = useState(false);

  const loadOrgs = useCallback(async () => {
    const { items } = await fetchOrganizationRows();
    setOrgs(items);
  }, []);

  useEffect(() => {
    void loadOrgs().catch(() => {});
  }, [loadOrgs]);

  const {
    admins,
    counts,
    loading,
    refreshing,
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
    refresh,
    loadMore,
    createAdmin,
    setAdminStatus,
    resetPassword,
    setRoles,
    removeAdmin,
    loadOrgRoles,
  } = useTenantAdminsData(orgs);

  const handleRefresh = useCallback(async () => {
    setOrgsRefreshing(true);
    try {
      await Promise.all([loadOrgs(), refresh()]);
    } finally {
      setOrgsRefreshing(false);
    }
  }, [loadOrgs, refresh]);

  const listRefreshing = refreshing || orgsRefreshing;

  const [newAdminUsername, setNewAdminUsername] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
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
      setError("Please select an organization.");
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
      setNewPasswordVisible(false);
    } catch {
      // error state set in hook
    }
  };

  // ── Dropdown option sets ──────────────────────────────────────────────────

  const statusOptions: DropdownOption<TenantAdminStatusFilter>[] = [
    {
      value: "all",
      label: "All admins",
      sublabel: counts ? `${counts.all} total` : undefined,
    },
    {
      value: "active",
      label: "Active only",
      sublabel: counts ? `${counts.active} active` : undefined,
    },
    {
      value: "disabled",
      label: "Disabled only",
      sublabel: counts ? `${counts.all - counts.active} disabled` : undefined,
    },
  ];

  const orgOptions: DropdownOption<string>[] = [
    { value: "all", label: "All organizations" },
    ...activeOrgs.map((org) => ({ value: org.id, label: org.name })),
  ];

  const orgCreateOptions: DropdownOption<string>[] = activeOrgs.map((org) => ({
    value: org.id,
    label: org.name,
  }));

  // ── Admin list row ────────────────────────────────────────────────────────

  const renderAdminItem = useCallback(
    ({ item, index }: { item: TenantAdminRead; index: number }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Manage ${item.username}`}
        className={`px-4 py-3 active:bg-surface ${index < admins.length - 1 ? "border-b border-border" : ""}`}
        onPress={() => void openManageSheet(item)}
      >
        {/* Row: avatar + details + status + chevron */}
        <View className="flex-row items-center gap-3">
          {/* Avatar initial */}
          <View className="h-10 w-10 items-center justify-center rounded-full bg-accentSoft">
            <Text className="text-sm font-bold text-accent">
              {item.username.charAt(0).toUpperCase()}
            </Text>
          </View>

          {/* Admin details */}
          <View className="flex-1 gap-0.5">
            <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
              {item.username}
            </Text>
            <Text className="text-xs font-medium text-muted" numberOfLines={1}>
              {item.organization_name}
            </Text>
            <Text className="text-xs text-muted">
              Last login: {formatLastLogin(item.last_login_at)}
            </Text>
          </View>

          {/* Status badge + chevron */}
          <View className="items-end gap-1.5">
            <StatusBadge active={item.is_active} />
            <MaterialCommunityIcons
              name="chevron-right"
              size={16}
              color={MUTED}
            />
          </View>
        </View>
      </Pressable>
    ),
    [admins.length, openManageSheet],
  );

  // ── List header ───────────────────────────────────────────────────────────

  const listHeader = (
    <View>
      {/* Search */}
      <View className="px-4 pt-3">
        <View className="flex-row items-center gap-2 rounded-control border border-border bg-card px-3">
          <MaterialCommunityIcons name="magnify" size={18} color={MUTED} />
          <TextInput
            accessibilityLabel="Search tenant admins by username"
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-[44px] flex-1 text-sm text-ink"
            placeholder="Search by username…"
            placeholderTextColor={MUTED}
            returnKeyType="search"
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setSearch("")}
            >
              <MaterialCommunityIcons
                name="close-circle"
                size={16}
                color={MUTED}
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Filter dropdowns — side by side */}
      <View className="flex-row gap-2 px-4 pt-2">
        <SelectDropdown
          label="Status"
          options={statusOptions}
          value={statusFilter}
          onSelect={setStatusFilter}
        />
        <SelectDropdown
          label="Organization"
          options={orgOptions}
          value={organizationFilter}
          onSelect={setOrganizationFilter}
        />
      </View>

      {/* Add admin form */}
      <View className="mx-4 mt-6 rounded-card border border-border bg-card p-4">
        <Text className="text-sm font-semibold text-ink">Add Tenant Admin</Text>

        {activeOrgs.length === 0 ? (
          <View className="mt-3 rounded-control border border-warningSoft bg-warningSoft px-4 py-3">
            <Text className="text-sm text-warning">
              Create an active organization first.
            </Text>
          </View>
        ) : (
          <View className="mt-4 gap-3">
            {/* Org selector dropdown */}
            <View>
              <Text className="mb-1.5 text-xs font-medium text-muted">
                Organization
              </Text>
              <SelectDropdown
                label="Organization"
                options={
                  orgCreateOptions.length > 0
                    ? orgCreateOptions
                    : [{ value: "", label: "No active organizations" }]
                }
                value={selectedOrgId ?? ""}
                onSelect={(v) => setSelectedOrgId(v || null)}
              />
            </View>

            {/* Username */}
            <View>
              <Text className="mb-1.5 text-xs font-medium text-muted">
                Username
              </Text>
              <TextInput
                accessibilityLabel="New admin username"
                autoCapitalize="none"
                autoCorrect={false}
                className="min-h-[44px] rounded-control border border-border bg-background px-4 py-2 text-sm text-ink"
                placeholder="min 3 characters"
                placeholderTextColor={MUTED}
                returnKeyType="next"
                value={newAdminUsername}
                onChangeText={setNewAdminUsername}
              />
            </View>

            {/* Password + eye toggle */}
            <View>
              <Text className="mb-1.5 text-xs font-medium text-muted">
                Initial Password
              </Text>
              <View className="flex-row items-center gap-2">
                <TextInput
                  accessibilityLabel="New admin password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="min-h-[44px] flex-1 rounded-control border border-border bg-background px-4 py-2 text-sm text-ink"
                  placeholder="min 8 characters"
                  placeholderTextColor={MUTED}
                  returnKeyType="done"
                  secureTextEntry={!newPasswordVisible}
                  value={newAdminPassword}
                  onChangeText={setNewAdminPassword}
                  onSubmitEditing={() => void handleCreate()}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    newPasswordVisible ? "Hide password" : "Show password"
                  }
                  className="min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-border bg-background active:bg-surface"
                  onPress={() => setNewPasswordVisible((v) => !v)}
                >
                  <MaterialCommunityIcons
                    name={
                      newPasswordVisible ? "eye-off-outline" : "eye-outline"
                    }
                    size={20}
                    color={MUTED}
                  />
                </Pressable>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              className={`mt-1 min-h-[44px] items-center justify-center rounded-control px-4 py-2 ${creating ? "bg-accent opacity-50" : "bg-accent active:opacity-80"}`}
              disabled={creating}
              onPress={() => void handleCreate()}
            >
              {creating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-sm font-semibold text-white">
                  Create Admin
                </Text>
              )}
            </Pressable>
          </View>
        )}

        {error ? (
          <View className="mt-4 rounded-control border border-dangerSoft bg-dangerSoft px-4 py-3">
            <Text className="text-sm text-danger">{error}</Text>
          </View>
        ) : null}
      </View>

      {/* List column header */}
      <View className="mt-6 flex-row items-center border-y border-border bg-surface px-4 py-2">
        <View className="mr-3 w-10" />
        <View className="flex-1">
          <Text className="text-xs font-semibold text-muted">Admin</Text>
        </View>
        <Text className="text-xs font-semibold text-muted">Status</Text>
        <View className="w-5" />
      </View>
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────────

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
            <Text className="text-2xl font-bold text-ink">Tenant Admins</Text>
            {counts ? (
              <Text className="mt-0.5 text-xs text-muted">
                {counts.active} active · {counts.all - counts.active} disabled
              </Text>
            ) : null}
          </View>
          <SuperAdminRefreshButton
            onRefresh={handleRefresh}
            refreshing={listRefreshing}
            disabled={creating || loadingMore}
          />
        </View>

        {loading && admins.length === 0 ? (
          <View className="flex-1">
            {listHeader}
            <SkeletonList rows={5} label="Loading tenant admins" />
          </View>
        ) : (
          <FlatList
            data={admins}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={listRefreshing}
                onRefresh={() => void handleRefresh()}
                tintColor={SUPER_ADMIN_REFRESH_TINT}
                colors={[SUPER_ADMIN_REFRESH_TINT]}
              />
            }
            ListEmptyComponent={
              <View className="mt-10 items-center px-8">
                <MaterialCommunityIcons
                  name="account-search-outline"
                  size={40}
                  color={MUTED}
                />
                <Text className="mt-3 text-center text-sm font-medium text-ink">
                  No admins found
                </Text>
                <Text className="mt-1 text-center text-xs text-muted">
                  Try adjusting your filters or search.
                </Text>
              </View>
            }
            ListFooterComponent={
              loadingMore ? (
                <ActivityIndicator className="my-4" color={ACCENT} />
              ) : null
            }
            ListHeaderComponent={listHeader}
            onEndReached={() => void loadMore()}
            onEndReachedThreshold={0.4}
            initialNumToRender={20}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews
            renderItem={renderAdminItem}
          />
        )}

        <TenantAdminManageSheet
          admin={managedAdmin}
          loadingRoles={loadingRoles}
          roles={sheetRoles}
          visible={managedAdmin != null}
          onClose={() => setManagedAdmin(null)}
          onDelete={(admin) => {
            setManagedAdmin(null);
            navigation.navigate("SuperAdminHardDelete", {
              resourceType: "tenantAdmin",
              resourceId: admin.id,
              resourceName: admin.username,
            });
          }}
          onResetPassword={(admin, password) =>
            resetPassword(admin.id, password)
          }
          onToggleStatus={(admin, nextActive) =>
            setAdminStatus(admin.id, nextActive)
          }
          onUpdateRoles={(admin, roleIds) => setRoles(admin.id, roleIds)}
        />
      </View>
    </View>
  );
}
