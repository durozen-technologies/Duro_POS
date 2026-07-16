import { apiClient } from "@/api/client";
import { AnalyticsPeriod } from "@/types/api";
import type { UUID } from "@/types/api";

export interface OrganizationRead {
  id: UUID;
  name: string;
  slug: string;
  is_active: boolean;
  max_branches: number;
  branch_count: number;
  remaining_branches: number;
  bill_number_prefix: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OrganizationRowsPage {
  items: OrganizationRead[];
  limit: number;
  has_more: boolean;
  next_cursor_created_at?: string | null;
  next_cursor_id?: UUID | null;
}

export interface OrganizationCounts {
  all: number;
  active: number;
  inactive: number;
}

export type SuperAdminAnalyticsDateRange = {
  startDate?: string | null;
  endDate?: string | null;
};

export interface SuperAdminBillingBranchRead {
  shop_id: UUID;
  shop_name: string;
  is_active: boolean;
  bill_count: number;
}

export interface SuperAdminBillingOrganizationRead {
  organization_id: UUID;
  organization_name: string;
  organization_slug: string;
  is_active: boolean;
  branch_count: number;
  total_bills_generated: number;
  branches: SuperAdminBillingBranchRead[];
}

export interface SuperAdminBillingSummary {
  total_organizations: number;
  total_branches: number;
  total_bills_generated: number;
  bills_generated_today: number;
}

export interface SuperAdminBillingOverviewRead {
  period: AnalyticsPeriod;
  reference_date?: string | null;
  range_start_date?: string | null;
  range_end_date?: string | null;
  summary: SuperAdminBillingSummary;
  organizations: SuperAdminBillingOrganizationRead[];
}

export interface AdminRoleRead {
  id: UUID;
  name: string;
  is_system: boolean;
}

export interface TenantAdminRead {
  id: UUID;
  username: string;
  shop_name?: string | null;
  role: string;
  organization_id: UUID;
  organization_name: string;
  is_active: boolean;
  role_ids: UUID[];
  created_at: string;
  last_login_at?: string | null;
}

export interface TenantAdminRowsPage {
  items: TenantAdminRead[];
  limit: number;
  has_more: boolean;
  next_cursor_created_at?: string | null;
  next_cursor_id?: UUID | null;
}

export interface TenantAdminCounts {
  all: number;
  active: number;
  inactive: number;
}

export interface BranchRead {
  id: UUID;
  name: string;
  is_active: boolean;
  created_at: string;
  username: string;
  last_active_at?: string | null;
}

export type HardDeletePayload = {
  username: string;
  password: string;
};

export interface AuditLogRead {
  id: UUID;
  action: string;
  entity_type: string;
  entity_id?: UUID | null;
  organization_id?: UUID | null;
  details: Record<string, unknown>;
  created_at: string;
  username?: string | null;
}

export interface AuditLogRowsPage {
  items: AuditLogRead[];
  limit: number;
  has_more: boolean;
  next_cursor_created_at?: string | null;
  next_cursor_id?: UUID | null;
}

export type AuditLogRowsParams = {
  limit?: number;
  organization_id?: UUID | null;
  cursor_created_at?: string | null;
  cursor_id?: UUID | null;
};

function auditLogRowParams(params: AuditLogRowsParams = {}) {
  const query: Record<string, string | number> = {};
  if (params.limit != null) query.limit = params.limit;
  if (params.organization_id) query.organization_id = params.organization_id;
  if (params.cursor_created_at) query.cursor_created_at = params.cursor_created_at;
  if (params.cursor_id) query.cursor_id = params.cursor_id;
  return query;
}

export type TenantAdminRowsParams = {
  limit?: number;
  organization_id?: UUID | null;
  q?: string;
  active?: boolean | null;
  cursor_created_at?: string | null;
  cursor_id?: UUID | null;
};

const SUPER_ADMIN_PREFIX = "/api/v1/super-admin";

function analyticsParams(
  period: AnalyticsPeriod,
  referenceDate?: string | null,
  range?: SuperAdminAnalyticsDateRange,
) {
  return {
    period,
    reference_date: referenceDate ?? undefined,
    range_start_date: range?.startDate ?? undefined,
    range_end_date: range?.endDate ?? undefined,
  };
}

function tenantAdminRowParams(params: TenantAdminRowsParams = {}) {
  const query: Record<string, string | number | boolean> = {};
  if (params.limit != null) query.limit = params.limit;
  if (params.organization_id) query.organization_id = params.organization_id;
  if (params.q?.trim()) query.q = params.q.trim();
  if (params.active != null) query.active = params.active;
  if (params.cursor_created_at) query.cursor_created_at = params.cursor_created_at;
  if (params.cursor_id) query.cursor_id = params.cursor_id;
  return query;
}

export type OrganizationRowsParams = {
  limit?: number;
  q?: string;
  active?: boolean | null;
  cursor_created_at?: string | null;
  cursor_id?: UUID | null;
};

function organizationRowParams(params: OrganizationRowsParams = {}) {
  const query: Record<string, string | number | boolean> = {};
  if (params.limit != null) query.limit = params.limit;
  if (params.q?.trim()) query.q = params.q.trim();
  if (params.active != null) query.active = params.active;
  if (params.cursor_created_at) query.cursor_created_at = params.cursor_created_at;
  if (params.cursor_id) query.cursor_id = params.cursor_id;
  return query;
}

export async function fetchOrganizationRows(params: OrganizationRowsParams = {}) {
  const { data } = await apiClient.get<OrganizationRowsPage>(
    `${SUPER_ADMIN_PREFIX}/organizations/rows`,
    { params: organizationRowParams(params) },
  );
  return data;
}

export async function fetchAllOrganizationRows() {
  const items: OrganizationRead[] = [];
  let cursor: { created_at: string; id: UUID } | null = null;

  for (;;) {
    const page = await fetchOrganizationRows({
      limit: 100,
      ...(cursor
        ? { cursor_created_at: cursor.created_at, cursor_id: cursor.id }
        : {}),
    });
    items.push(...page.items);
    if (
      !page.has_more ||
      !page.next_cursor_created_at ||
      !page.next_cursor_id
    ) {
      break;
    }
    cursor = {
      created_at: page.next_cursor_created_at,
      id: page.next_cursor_id,
    };
  }

  return items;
}

export async function fetchOrganizationCounts() {
  const { data } = await apiClient.get<OrganizationCounts>(
    `${SUPER_ADMIN_PREFIX}/organizations/counts`,
  );
  return data;
}

export type SuperAdminBillingOverviewFilters = {
  organizationId?: UUID | null;
  shopId?: UUID | null;
};

export async function fetchSuperAdminBillingOverview(
  period: AnalyticsPeriod,
  referenceDate?: string | null,
  range?: SuperAdminAnalyticsDateRange,
  filters?: SuperAdminBillingOverviewFilters,
) {
  const { data } = await apiClient.get<SuperAdminBillingOverviewRead>(
    `${SUPER_ADMIN_PREFIX}/analytics/billing-overview`,
    {
      params: {
        ...analyticsParams(period, referenceDate, range),
        organization_id: filters?.organizationId ?? undefined,
        shop_id: filters?.shopId ?? undefined,
      },
    },
  );
  return data;
}

export async function fetchOrganizationAdminRoles(organizationId: UUID) {
  const { data } = await apiClient.get<AdminRoleRead[]>(
    `${SUPER_ADMIN_PREFIX}/organizations/${organizationId}/admin-roles`,
  );
  return data;
}

export async function fetchTenantAdminRows(params: TenantAdminRowsParams = {}) {
  const { data } = await apiClient.get<TenantAdminRowsPage>(
    `${SUPER_ADMIN_PREFIX}/tenant-admins/rows`,
    { params: tenantAdminRowParams(params) },
  );
  return data;
}

export async function fetchTenantAdminCounts(organizationId?: UUID | null) {
  const { data } = await apiClient.get<TenantAdminCounts>(
    `${SUPER_ADMIN_PREFIX}/tenant-admins/counts`,
    {
      params: organizationId ? { organization_id: organizationId } : undefined,
    },
  );
  return data;
}

export async function fetchTenantAdmin(userId: UUID) {
  const { data } = await apiClient.get<TenantAdminRead>(
    `${SUPER_ADMIN_PREFIX}/tenant-admins/${userId}`,
  );
  return data;
}

export async function fetchAuditLogRows(params: AuditLogRowsParams = {}) {
  const { data } = await apiClient.get<AuditLogRowsPage>(
    `${SUPER_ADMIN_PREFIX}/audit-logs/rows`,
    { params: auditLogRowParams(params) },
  );
  return data;
}

export async function createOrganization(payload: {
  name: string;
  slug?: string;
  max_branches?: number;
}) {
  const { data } = await apiClient.post<OrganizationRead>(
    `${SUPER_ADMIN_PREFIX}/organizations`,
    payload,
  );
  return data;
}

export async function patchOrganization(
  organizationId: UUID,
  payload: { name?: string; max_branches?: number; bill_number_prefix?: string },
) {
  const { data } = await apiClient.patch<OrganizationRead>(
    `${SUPER_ADMIN_PREFIX}/organizations/${organizationId}`,
    payload,
  );
  return data;
}

export async function createTenantAdmin(payload: {
  username: string;
  shop_name?: string | null;
  password: string;
  organization_id: UUID;
}) {
  const { data } = await apiClient.post<TenantAdminRead>(
    `${SUPER_ADMIN_PREFIX}/tenant-admins`,
    payload,
  );
  return data;
}

export async function patchTenantAdminStatus(userId: UUID, is_active: boolean) {
  const { data } = await apiClient.patch<TenantAdminRead>(
    `${SUPER_ADMIN_PREFIX}/tenant-admins/${userId}/status`,
    { is_active },
  );
  return data;
}

export async function resetTenantAdminPassword(userId: UUID, password: string) {
  const { data } = await apiClient.post<TenantAdminRead>(
    `${SUPER_ADMIN_PREFIX}/tenant-admins/${userId}/reset-password`,
    { password },
  );
  return data;
}

export async function updateTenantAdminRoles(userId: UUID, role_ids: UUID[]) {
  const { data } = await apiClient.put<TenantAdminRead>(
    `${SUPER_ADMIN_PREFIX}/tenant-admins/${userId}/roles`,
    { role_ids },
  );
  return data;
}

export async function hardDeleteTenantAdmin(userId: UUID, payload: HardDeletePayload) {
  await apiClient.post(`${SUPER_ADMIN_PREFIX}/tenant-admins/${userId}/hard-delete`, payload);
}

export async function hardDeleteOrganization(organizationId: UUID, payload: HardDeletePayload) {
  await apiClient.post(
    `${SUPER_ADMIN_PREFIX}/organizations/${organizationId}/hard-delete`,
    payload,
  );
}

export async function fetchOrganizationBranches(organizationId: UUID) {
  const { data } = await apiClient.get<BranchRead[]>(
    `${SUPER_ADMIN_PREFIX}/organizations/${organizationId}/branches`,
  );
  return data;
}

export async function hardDeleteBranch(
  organizationId: UUID,
  shopId: UUID,
  payload: HardDeletePayload,
) {
  await apiClient.post(
    `${SUPER_ADMIN_PREFIX}/organizations/${organizationId}/branches/${shopId}/hard-delete`,
    payload,
  );
}

export async function deleteTenantAdmin(userId: UUID) {
  await apiClient.delete(`${SUPER_ADMIN_PREFIX}/tenant-admins/${userId}`);
}

export async function patchOrganizationStatus(organizationId: UUID, is_active: boolean) {
  const { data } = await apiClient.patch<OrganizationRead>(
    `${SUPER_ADMIN_PREFIX}/organizations/${organizationId}/status`,
    { is_active },
  );
  return data;
}
