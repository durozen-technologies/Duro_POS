import { useCallback, useEffect, useState } from "react";

import { getApiConnectionSnapshot, probeApiConnection, subscribeApiConnection, type ApiConnectionSnapshot } from "@/api/client";

export function useApiConnection() {
  const [snapshot, setSnapshot] = useState<ApiConnectionSnapshot>(() => getApiConnectionSnapshot());
  const [checking, setChecking] = useState(false);

  useEffect(() => subscribeApiConnection(() => setSnapshot(getApiConnectionSnapshot())), []);

  const retry = useCallback(async () => {
    setChecking(true);
    try {
      setSnapshot(await probeApiConnection());
    } finally {
      setChecking(false);
    }
  }, []);

  return { ...snapshot, checking, retry };
}
