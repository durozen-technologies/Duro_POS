import { MaterialCommunityIcons } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { toApiError, formatApiErrorMessage } from "@/api/client";
import {
  fetchOrganizationBranches,
  fetchOrganizationRows,
  fetchSuperAdminBillingOverview,
  type OrganizationRead,
  type SuperAdminBillingOrganizationRead,
} from "@/api/super-admin";
import type { AppStackParamList } from "@/navigation/types";
import { hasAuthToken, skipUnlessAuthed } from "@/store/auth-store";
import { AnalyticsPeriod, type UUID } from "@/types/api";
import { isAuthSessionError } from "@/utils/auth-errors";
import { formatDate } from "@/utils/format";

import { SUPER_ADMIN_REFRESH_TINT, SuperAdminRefreshButton } from "./super-admin-refresh-button";
import { SuperAdminSelectDropdown } from "./super-admin-select-dropdown";

type Nav = NativeStackNavigationProp<AppStackParamList, "SuperAdminBillingOverview">;

const INK = "#0A110D";
const MUTED = "#4B6356";
const ALL_ORGANIZATIONS = "";
const ALL_BRANCHES = "";
const numberFormatter = new Intl.NumberFormat("en-IN");

const PERIOD_OPTIONS = [
  { key: AnalyticsPeriod.DATE, label: "Today" },
  { key: AnalyticsPeriod.WEEK, label: "This Week" },
  { key: AnalyticsPeriod.MONTH, label: "This Month" },
  { key: AnalyticsPeriod.YEAR, label: "This Year" },
  { key: AnalyticsPeriod.RANGE, label: "Custom Range" },
] as const;

function toDateValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysAgo(value: number) {
  const date = new Date();
  date.setDate(date.getDate() - value);
  return toDateValue(date);
}

function isValidDateValue(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && toDateValue(parsed) === value;
}

function formatFilterLabel(
  period: AnalyticsPeriod,
  referenceDate: string,
  rangeStartDate: string,
  rangeEndDate: string,
) {
  if (period === AnalyticsPeriod.DATE) return `Today · ${formatDate(referenceDate)}`;
  if (period === AnalyticsPeriod.WEEK) return "This week";
  if (period === AnalyticsPeriod.MONTH) return "This month";
  if (period === AnalyticsPeriod.YEAR) return "This year";
  if (!isValidDateValue(rangeStartDate) || !isValidDateValue(rangeEndDate)) return "Custom range";
  return `${formatDate(rangeStartDate)} - ${formatDate(rangeEndDate)}`;
}

function formatCount(value: number) {
  return numberFormatter.format(value);
}

function asPercentWidth(value: number): `${number}%` {
  return `${value}%`;
}

// Subcomponents to prevent excessive re-renders (Performance Optimization)

const MetricCard = memo(function MetricCard({
  title,
  value,
  subtitle,
  variant = "default",
}: {
  title: string;
  value: string | number;
  subtitle: string;
  variant?: "default" | "accent" | "success";
}) {
  const isAccent = variant === "accent";
  const isSuccess = variant === "success";

  return (
    <View
      className={`min-w-[160px] flex-1 rounded-card border px-5 py-4 ${
        isAccent ? "border-accent bg-accentSoft" : isSuccess ? "border-success bg-successSoft" : "border-border bg-card"
      }`}
    >
      <Text
        className={`text-sm font-medium ${
          isAccent ? "text-accent" : isSuccess ? "text-success" : "text-muted"
        }`}
      >
        {title}
      </Text>
      <Text
        className={`mt-2 text-3xl font-bold tracking-tight ${
          isSuccess ? "text-success" : "text-ink"
        }`}
      >
        {value}
      </Text>
      <Text
        className={`mt-1 text-xs ${
          isAccent ? "text-muted" : isSuccess ? "text-success" : "text-muted"
        }`}
      >
        {subtitle}
      </Text>
    </View>
  );
});

const SkeletonMetricCards = memo(function SkeletonMetricCards() {
  return (
    <View className="mt-4 flex-row flex-wrap gap-4">
      {[0, 1, 2, 3].map((i) => (
        <View key={i} className="h-[104px] min-w-[160px] flex-1 rounded-card border border-border bg-surface" />
      ))}
    </View>
  );
});

const OrganizationBarRow = memo(function OrganizationBarRow({
  org,
  maxOrgBills,
  isLast,
}: {
  org: SuperAdminBillingOrganizationRead;
  maxOrgBills: number;
  isLast: boolean;
}) {
  const barWidth = useMemo(
    () => asPercentWidth(Math.max(6, Math.round((org.total_bills_generated / maxOrgBills) * 100))),
    [org.total_bills_generated, maxOrgBills]
  );

  return (
    <View className={isLast ? "" : "mb-5"}>
      <View className="mb-2 flex-row items-center justify-between">
        <View className="mr-4 flex-1">
          <Text className="text-base font-semibold text-ink">{org.organization_name}</Text>
          <Text className="text-sm text-muted">
            {org.branch_count} branches · {org.organization_slug}
          </Text>
        </View>
        <Text className="text-base font-bold text-ink">{formatCount(org.total_bills_generated)}</Text>
      </View>
      <View className="h-2.5 overflow-hidden rounded-full bg-surface">
        <View className="h-full rounded-full bg-accent" style={{ width: org.total_bills_generated > 0 ? barWidth : "0%" }} />
      </View>
    </View>
  );
});

const BranchBreakdownRow = memo(function BranchBreakdownRow({
  branch,
  branchMax,
  isLast,
}: {
  branch: { shop_id: string; shop_name: string; bill_count: number; is_active: boolean };
  branchMax: number;
  isLast: boolean;
}) {
  const barWidth = useMemo(
    () => (branch.bill_count > 0 ? asPercentWidth(Math.max(8, Math.round((branch.bill_count / branchMax) * 100))) : "0%"),
    [branch.bill_count, branchMax]
  );

  return (
    <View className={isLast ? "" : "mb-4"}>
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text className="flex-1 text-sm font-medium text-ink">{branch.shop_name}</Text>
        <Text className="ml-3 text-sm font-bold text-ink">{formatCount(branch.bill_count)}</Text>
      </View>
      <View className="flex-row items-center gap-3">
        <View className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
          <View className={`h-full rounded-full ${branch.is_active ? "bg-accent" : "bg-border"}`} style={{ width: barWidth }} />
        </View>
        <Text className="text-xs text-muted w-14 text-right">{branch.is_active ? "Active" : "Inactive"}</Text>
      </View>
    </View>
  );
});

const OrganizationBranchCard = memo(function OrganizationBranchCard({
  org,
}: {
  org: SuperAdminBillingOrganizationRead;
}) {
  const branchMax = useMemo(() => Math.max(1, ...org.branches.map((b) => b.bill_count)), [org.branches]);

  return (
    <View className="mb-4 rounded-card border border-border bg-card p-5">
      <View className="mb-5 flex-row items-center justify-between border-b border-border pb-4">
        <View className="flex-1">
          <Text className="text-lg font-bold text-ink">{org.organization_name}</Text>
          <Text className="mt-0.5 text-sm text-muted">
            {formatCount(org.total_bills_generated)} bills · {org.branch_count} branches
          </Text>
        </View>
        <View className={`rounded-control px-2.5 py-1 ${org.is_active ? "bg-successSoft" : "bg-surface"}`}>
          <Text className={`text-xs font-bold tracking-wide uppercase ${org.is_active ? "text-success" : "text-muted"}`}>
            {org.is_active ? "Active" : "Inactive"}
          </Text>
        </View>
      </View>
      
      {org.branches.length === 0 ? (
        <View className="rounded-control bg-surface p-4">
          <Text className="text-sm text-muted">No branches provisioned yet.</Text>
        </View>
      ) : (
        org.branches.map((branch, index) => (
          <BranchBreakdownRow
            key={branch.shop_id}
            branch={branch}
            branchMax={branchMax}
            isLast={index === org.branches.length - 1}
          />
        ))
      )}
    </View>
  );
});

export function SuperAdminBillingOverviewScreen() {
  const navigation = useNavigation<Nav>();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>(AnalyticsPeriod.DATE);
  const [referenceDate] = useState(() => toDateValue(new Date()));
  const [rangeStartDate, setRangeStartDate] = useState(() => daysAgo(6));
  const [rangeEndDate, setRangeEndDate] = useState(() => toDateValue(new Date()));
  
  const [orgOptions, setOrgOptions] = useState<OrganizationRead[]>([]);
  const [branchOptions, setBranchOptions] = useState<{ id: UUID; name: string; is_active: boolean }[]>([]);
  
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(ALL_ORGANIZATIONS);
  const [selectedShopId, setSelectedShopId] = useState(ALL_BRANCHES);
  
  const [overview, setOverview] = useState<{
    summary: {
      total_organizations: number;
      total_branches: number;
      total_bills_generated: number;
      bills_generated_today: number;
    };
    organizations: SuperAdminBillingOrganizationRead[];
  } | null>(null);

  const rangeError = useMemo(() => {
    if (analyticsPeriod !== AnalyticsPeriod.RANGE) return null;
    if (!isValidDateValue(rangeStartDate) || !isValidDateValue(rangeEndDate)) {
      return "Enter start and end dates as YYYY-MM-DD.";
    }
    if (rangeEndDate < rangeStartDate) {
      return "End date must be on or after start date.";
    }
    return null;
  }, [analyticsPeriod, rangeEndDate, rangeStartDate]);

  const organizationDropdownOptions = useMemo(
    () => [
      { value: ALL_ORGANIZATIONS, label: "All organizations" },
      ...orgOptions.map((org) => ({ value: org.id, label: org.name, sublabel: org.slug })),
    ],
    [orgOptions]
  );

  const branchDropdownOptions = useMemo(
    () => [
      { value: ALL_BRANCHES, label: "All branches" },
      ...branchOptions.map((branch) => ({
        value: branch.id,
        label: branch.name,
        sublabel: branch.is_active ? "Active branch" : "Inactive branch",
      })),
    ],
    [branchOptions]
  );

  const scopeLabel = useMemo(() => {
    if (!selectedOrganizationId) return "All organizations and branches";
    const org = orgOptions.find((item) => item.id === selectedOrganizationId);
    if (!selectedShopId) return org ? `${org.name} · all branches` : "Selected organization";
    const branch = branchOptions.find((item) => item.id === selectedShopId);
    return org && branch ? `${org.name} · ${branch.name}` : "Selected branch";
  }, [branchOptions, orgOptions, selectedOrganizationId, selectedShopId]);

  const loadOrgOptions = useCallback(async () => {
    try {
      const { items } = await fetchOrganizationRows({ limit: 100 });
      setOrgOptions(items);
    } catch {
      setOrgOptions([]);
    }
  }, []);

  const loadBranchOptions = useCallback(async (organizationId: UUID) => {
    try {
      const branches = await fetchOrganizationBranches(organizationId);
      setBranchOptions(branches);
    } catch {
      setBranchOptions([]);
    }
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    if (
      skipUnlessAuthed(() => {
        setLoading(false);
        setRefreshing(false);
      })
    ) {
      return;
    }
    if (analyticsPeriod === AnalyticsPeriod.RANGE && rangeError) {
      setError(rangeError);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    
    setError(null);
    try {
      const data = await fetchSuperAdminBillingOverview(
        analyticsPeriod,
        analyticsPeriod === AnalyticsPeriod.RANGE ? undefined : referenceDate,
        analyticsPeriod === AnalyticsPeriod.RANGE ? { startDate: rangeStartDate, endDate: rangeEndDate } : undefined,
        { organizationId: selectedOrganizationId || null, shopId: selectedShopId || null }
      );
      setOverview({ summary: data.summary, organizations: data.organizations });
    } catch (err) {
      if (isAuthSessionError(err)) {
        return;
      }
      setError(formatApiErrorMessage(err, "Failed to load billing overview"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [analyticsPeriod, rangeEndDate, rangeError, rangeStartDate, referenceDate, selectedOrganizationId, selectedShopId]);

  const handleRefresh = useCallback(() => {
    void load(true);
  }, [load]);

  const handleSelectOrganization = useCallback((organizationId: string) => {
    setSelectedOrganizationId(organizationId);
    setSelectedShopId(ALL_BRANCHES);
    if (!organizationId) setBranchOptions([]);
  }, []);

  useEffect(() => { void loadOrgOptions(); }, [loadOrgOptions]);

  useEffect(() => {
    if (selectedOrganizationId) void loadBranchOptions(selectedOrganizationId);
  }, [loadBranchOptions, selectedOrganizationId]);

  useEffect(() => { void load(); }, [load]);

  const orgs = overview?.organizations ?? [];
  const summary = overview?.summary;
  const maxOrgBills = useMemo(() => Math.max(1, ...orgs.map((org) => org.total_bills_generated)), [orgs]);
  const filterLabel = useMemo(
    () => formatFilterLabel(analyticsPeriod, referenceDate, rangeStartDate, rangeEndDate),
    [analyticsPeriod, rangeEndDate, rangeStartDate, referenceDate]
  );

  return (
    <View className="flex-1 bg-background">
      <View className="mx-auto w-full max-w-5xl flex-1">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 64 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={SUPER_ADMIN_REFRESH_TINT} />
          }
        >
          {/* Header */}
          <View className="flex-row items-center gap-4 px-5 pb-5 pt-10">
            <Pressable
              accessibilityRole="button"
              className="min-h-[48px] min-w-[48px] items-center justify-center rounded-control border border-border bg-card active:opacity-80"
              onPress={() => navigation.goBack()}
            >
              <MaterialCommunityIcons name="arrow-left" size={24} color={INK} />
            </Pressable>
            <View className="flex-1">
              <Text className="text-3xl font-bold tracking-tight text-ink">Billing Overview</Text>
              <Text className="mt-1 text-sm text-muted">Aggregated counts across all tenants</Text>
            </View>
            <SuperAdminRefreshButton onRefresh={handleRefresh} refreshing={refreshing} />
          </View>

          {/* Controls & Filters */}
          <View className="px-5">
            <View className="rounded-card border border-border bg-card p-5">
              <View className="flex-row flex-wrap gap-2.5">
                {PERIOD_OPTIONS.map((option) => (
                  <Pressable
                    key={option.key}
                    className={`rounded-full border px-4 py-2.5 ${
                      analyticsPeriod === option.key ? "border-accent bg-accentSoft" : "border-border bg-surface"
                    }`}
                    onPress={() => setAnalyticsPeriod(option.key)}
                  >
                    <Text className={`text-sm font-semibold ${analyticsPeriod === option.key ? "text-accent" : "text-muted"}`}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {analyticsPeriod === AnalyticsPeriod.RANGE && (
                <View className="mt-5 border-t border-border pt-5">
                  <Text className="mb-2.5 text-sm font-bold text-ink">Custom Date Range</Text>
                  <View className="flex-row gap-4">
                    <TextInput
                      className="min-h-[48px] flex-1 rounded-control border border-border bg-surface px-4 py-2 text-base font-medium text-ink"
                      placeholder="Start (YYYY-MM-DD)"
                      placeholderTextColor={MUTED}
                      value={rangeStartDate}
                      onChangeText={setRangeStartDate}
                    />
                    <TextInput
                      className="min-h-[48px] flex-1 rounded-control border border-border bg-surface px-4 py-2 text-base font-medium text-ink"
                      placeholder="End (YYYY-MM-DD)"
                      placeholderTextColor={MUTED}
                      value={rangeEndDate}
                      onChangeText={setRangeEndDate}
                    />
                  </View>
                </View>
              )}

              <View className="mt-5 rounded-control bg-surface p-4 border border-border/50">
                <Text className="text-xs font-bold uppercase tracking-wider text-muted">Active Window</Text>
                <Text className="mt-1 text-base font-bold text-ink">{filterLabel}</Text>
                <Text className="mt-0.5 text-sm text-muted">{scopeLabel}</Text>
              </View>
            </View>

            <View className="mt-5 flex-row gap-4">
              <SuperAdminSelectDropdown
                label="Organization Scope"
                options={organizationDropdownOptions}
                value={selectedOrganizationId}
                onSelect={handleSelectOrganization}
              />
              <SuperAdminSelectDropdown
                label="Branch Scope"
                options={branchDropdownOptions}
                value={selectedShopId}
                disabled={!selectedOrganizationId}
                onSelect={setSelectedShopId}
              />
            </View>

            {/* Metrics */}
            {loading ? (
              <SkeletonMetricCards />
            ) : summary ? (
              <View className="mt-5 flex-row flex-wrap gap-4">
                <MetricCard title="Total Organizations" value={formatCount(summary.total_organizations)} subtitle="active and inactive" />
                <MetricCard title="Total Branches" value={formatCount(summary.total_branches)} subtitle="all organizations" />
                <MetricCard title="Total Bills Generated" value={formatCount(summary.total_bills_generated)} subtitle={filterLabel} variant="accent" />
                <MetricCard title="Bills Generated Today" value={formatCount(summary.bills_generated_today)} subtitle="current day" variant="success" />
              </View>
            ) : null}

            {error || rangeError ? (
              <View className="mt-4 rounded-control border border-dangerSoft bg-dangerSoft px-4 py-3">
                <Text className="text-sm font-medium text-danger">{rangeError ?? error}</Text>
              </View>
            ) : null}
          </View>

          {/* Org Chart */}
          {!loading && orgs.length > 0 && (
            <View className="mt-8 px-5">
              <Text className="mb-4 text-sm font-bold tracking-wide text-muted uppercase">Organizations by Bills</Text>
              <View className="rounded-card border border-border bg-card p-5">
                {orgs.map((org, index) => (
                  <OrganizationBarRow key={org.organization_id} org={org} maxOrgBills={maxOrgBills} isLast={index === orgs.length - 1} />
                ))}
              </View>
            </View>
          )}

          {/* Branch Breakdown */}
          {!loading && orgs.length > 0 && (
            <View className="mt-8 px-5">
              <Text className="mb-4 text-sm font-bold tracking-wide text-muted uppercase">Branch Breakdown</Text>
              {orgs.map((org) => (
                <OrganizationBranchCard key={org.organization_id} org={org} />
              ))}
            </View>
          )}

          {/* Org Table */}
          {!loading && (
            <View className="mt-8 px-5">
              <Text className="mb-4 text-sm font-bold tracking-wide text-muted uppercase">Organization Table</Text>
              <View className="rounded-card border border-border bg-card overflow-hidden">
                <View className="flex-row bg-surface px-5 py-3 border-b border-border">
                  <Text className="flex-[1.6] text-xs font-bold uppercase tracking-wide text-muted">Organization</Text>
                  <Text className="flex-1 text-xs font-bold uppercase tracking-wide text-muted">Branches</Text>
                  <Text className="flex-1 text-right text-xs font-bold uppercase tracking-wide text-muted">Bills</Text>
                </View>
                {orgs.length === 0 ? (
                  <View className="px-5 py-8 items-center justify-center">
                    <MaterialCommunityIcons name="text-search" size={32} color={MUTED} style={{ opacity: 0.5, marginBottom: 8 }} />
                    <Text className="text-sm font-medium text-muted">No organizations found.</Text>
                  </View>
                ) : (
                  orgs.map((org, index) => (
                    <View key={org.organization_id} className={`flex-row items-center px-5 py-4 ${index < orgs.length - 1 ? "border-b border-border/50" : ""}`}>
                      <View className="flex-[1.6] pr-4">
                        <Text className="text-sm font-bold text-ink">{org.organization_name}</Text>
                        <Text className="mt-1 text-xs text-muted">Top: {org.branches[0]?.shop_name ?? "None"}</Text>
                      </View>
                      <Text className="flex-1 text-sm font-medium text-ink">{formatCount(org.branch_count)}</Text>
                      <Text className="flex-1 text-right text-sm font-bold text-ink">{formatCount(org.total_bills_generated)}</Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}
