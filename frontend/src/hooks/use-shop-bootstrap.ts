import { useCallback, useEffect, useRef, useState } from "react";

import { toApiError } from "@/api/client";
import { fetchShopBootstrap } from "@/api/prices";
import { useAuthStore } from "@/store/auth-store";
import { usePriceStore } from "@/store/price-store";
import { DailyPriceRead, ShopBootstrapResponse, UUID } from "@/types/api";

type ShopBootstrapBundle = {
  bootstrap: ShopBootstrapResponse;
  todayPrices: DailyPriceRead[];
};

const inFlightBootstrapRequests = new Map<UUID, Promise<ShopBootstrapBundle>>();

async function loadBootstrapBundle(userId: UUID, forceRefresh = false) {
  if (!forceRefresh) {
    const existingRequest = inFlightBootstrapRequests.get(userId);
    if (existingRequest) {
      return existingRequest;
    }
  }

  const request = (async () => {
    const bootstrap = await fetchShopBootstrap();
    const todayPrices: DailyPriceRead[] = [];

    return { bootstrap, todayPrices };
  })();

  inFlightBootstrapRequests.set(userId, request);

  try {
    return await request;
  } finally {
    if (inFlightBootstrapRequests.get(userId) === request) {
      inFlightBootstrapRequests.delete(userId);
    }
  }
}

export function useShopBootstrap() {
  const user = useAuthStore((state) => state.user);
  const bootstrap = usePriceStore((state) => state.bootstrap);
  const setBootstrap = usePriceStore((state) => state.setBootstrap);
  const setTodayPrices = usePriceStore((state) => state.setTodayPrices);
  const [loading, setLoading] = useState(user?.role === "shop_account" && !bootstrap);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (options?: { forceRefresh?: boolean; showLoading?: boolean }) => {
    if (user?.role !== "shop_account") {
      if (mountedRef.current) {
        setLoading(false);
      }
      return null;
    }

    const requestId = ++requestIdRef.current;
    const { forceRefresh = true, showLoading = true } = options ?? {};

    if (showLoading && mountedRef.current) {
      setLoading(true);
    }
    if (mountedRef.current) {
      setError(null);
    }

    try {
      const bundle = await loadBootstrapBundle(user.id, forceRefresh);

      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return bundle.bootstrap;
      }

      setBootstrap(bundle.bootstrap);
      setTodayPrices(bundle.todayPrices);
      return bundle.bootstrap;
    } catch (err) {
      const message = toApiError(err).message;

      if (mountedRef.current && requestId === requestIdRef.current) {
        setError(message);
      }

      return null;
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [setBootstrap, setTodayPrices, user]);

  useEffect(() => {
    if (user?.role !== "shop_account") {
      setLoading(false);
      return;
    }

    void refresh({
      forceRefresh: false,
      showLoading: !bootstrap,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const forceRefresh = useCallback(() => refresh({ forceRefresh: true, showLoading: true }), [refresh]);

  return {
    bootstrap: bootstrap as ShopBootstrapResponse | null,
    loading,
    error,
    refresh: forceRefresh,
  };
}
