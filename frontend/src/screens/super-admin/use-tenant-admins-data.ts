import { useCallback, useEffect, useRef, useState } from "react";

import { toApiError, formatApiErrorMessage } from "@/api/client";
import {
  createTenantAdmin,
  hardDeleteTenantAdmin,
  fetchTenantAdmin,
  fetchTenantAdminCounts,
  fetchTenantAdminRows,
  fetchOrganizationAdminRoles,
  patchTenantAdminStatus,
  resetTenantAdminPassword,
  updateTenantAdminRoles,
  type AdminRoleRead,
  type HardDeletePayload,
  type OrganizationRead,
  type TenantAdminCounts,
  type TenantAdminRead,
} from "@/api/super-admin";
import { hasAuthToken, skipUnlessAuthed } from "@/store/auth-store";
import type { UUID } from "@/types/api";
import { isAuthSessionError } from "@/utils/auth-errors";

export type TenantAdminStatusFilter = "all" | "active" | "disabled";

const PAGE_SIZE = 50;

function activeFilterValue(filter: TenantAdminStatusFilter): boolean | null {
  if (filter === "active") return true;
  if (filter === "disabled") return false;
  return null;
}

export function useTenantAdminsData(orgs: OrganizationRead[]) {
  const [admins, setAdmins] = useState<TenantAdminRead[]>([]);
  const [counts, setCounts] = useState<TenantAdminCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [organizationFilter, setOrganizationFilter] = useState<UUID | "all">(
    "all",
  );
  const [statusFilter, setStatusFilter] =
    useState<TenantAdminStatusFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState<UUID | null>(null);
  const cursorRef = useRef<{ created_at: string; id: UUID } | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    const firstActive = orgs.find((org) => org.is_active);
    setSelectedOrgId((current) => {
      if (current && orgs.some((org) => org.id === current && org.is_active)) {
        return current;
      }
      return firstActive?.id ?? null;
    });
  }, [orgs]);

  const listParams = useCallback(
    (cursor?: { created_at: string; id: UUID } | null) => ({
      limit: PAGE_SIZE,
      organization_id: organizationFilter === "all" ? null : organizationFilter,
      q: debouncedSearch || undefined,
      active: activeFilterValue(statusFilter),
      cursor_created_at: cursor?.created_at ?? null,
      cursor_id: cursor?.id ?? null,
    }),
    [organizationFilter, debouncedSearch, statusFilter],
  );

  const loadFirstPage = useCallback(async (isRefresh = false) => {
    if (
      skipUnlessAuthed(() => {
        setLoading(false);
        setRefreshing(false);
      })
    ) {
      return;
    }
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const orgId = organizationFilter === "all" ? null : organizationFilter;
      const [rows, nextCounts] = await Promise.all([
        fetchTenantAdminRows(listParams(null)),
        fetchTenantAdminCounts(orgId),
      ]);
      setAdmins(rows.items);
      setHasMore(rows.has_more);
      setCounts(nextCounts);
      cursorRef.current =
        rows.has_more && rows.next_cursor_created_at && rows.next_cursor_id
          ? { created_at: rows.next_cursor_created_at, id: rows.next_cursor_id }
          : null;
    } catch (loadError) {
      if (isAuthSessionError(loadError)) {
        return;
      }
      setError(formatApiErrorMessage(loadError, "Failed to load tenant admins"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [listParams, organizationFilter]);

  const refresh = useCallback(() => loadFirstPage(true), [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading || !cursorRef.current) {
      return;
    }
    setLoadingMore(true);
    setError(null);
    try {
      const rows = await fetchTenantAdminRows(listParams(cursorRef.current));
      setAdmins((current) => [...current, ...rows.items]);
      setHasMore(rows.has_more);
      cursorRef.current =
        rows.has_more && rows.next_cursor_created_at && rows.next_cursor_id
          ? { created_at: rows.next_cursor_created_at, id: rows.next_cursor_id }
          : null;
    } catch (loadError) {
      setError(
        formatApiErrorMessage(loadError, "Failed to load more tenant admins"),
      );
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, listParams, loading, loadingMore]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const createAdmin = useCallback(
    async (
      username: string,
      password: string,
      organization_id: UUID,
      shop_name?: string | null,
    ) => {
      setCreating(true);
      setError(null);
      try {
        await createTenantAdmin({ username, password, organization_id, shop_name });
        await loadFirstPage();
      } catch (createError) {
        const message =
          formatApiErrorMessage(createError, "Failed to create tenant admin");
        setError(message);
        throw new Error(message);
      } finally {
        setCreating(false);
      }
    },
    [loadFirstPage],
  );

  const refreshAdmin = useCallback(async (userId: UUID) => {
    const updated = await fetchTenantAdmin(userId);
    setAdmins((current) =>
      current.map((admin) => (admin.id === userId ? updated : admin)),
    );
    return updated;
  }, []);

  const setAdminStatus = useCallback(
    async (userId: UUID, is_active: boolean) => {
      await patchTenantAdminStatus(userId, is_active);
      await refreshAdmin(userId);
      await loadFirstPage();
    },
    [loadFirstPage, refreshAdmin],
  );

  const resetPassword = useCallback(
    async (userId: UUID, password: string) => {
      await resetTenantAdminPassword(userId, password);
      await refreshAdmin(userId);
    },
    [refreshAdmin],
  );

  const setRoles = useCallback(
    async (userId: UUID, role_ids: UUID[]) => {
      await updateTenantAdminRoles(userId, role_ids);
      await refreshAdmin(userId);
    },
    [refreshAdmin],
  );

  const removeAdmin = useCallback(
    async (userId: UUID, credentials: HardDeletePayload) => {
      await hardDeleteTenantAdmin(userId, credentials);
      setAdmins((current) => current.filter((admin) => admin.id !== userId));
      await loadFirstPage();
    },
    [loadFirstPage],
  );

  const loadOrgRoles = useCallback(
    async (organizationId: UUID): Promise<AdminRoleRead[]> => {
      return fetchOrganizationAdminRoles(organizationId);
    },
    [],
  );

  return {
    admins,
    counts,
    loading,
    refreshing,
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
    loadFirstPage,
    refresh,
    loadMore,
    createAdmin,
    setAdminStatus,
    resetPassword,
    setRoles,
    removeAdmin,
    loadOrgRoles,
    refreshAdmin,
  };
}
