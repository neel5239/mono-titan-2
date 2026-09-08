import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, isNetworkError } from '../api/client';
import type { HealthResponse } from '../api/types';

interface HealthState {
  health: HealthResponse | null;
  /** true once we know the server is unreachable */
  serverDown: boolean;
  /** true until the first health response or failure */
  checking: boolean;
  refresh: () => Promise<void>;
}

const HealthContext = createContext<HealthState | null>(null);

const POLL_OK_MS = 60_000;
const POLL_DOWN_MS = 5_000;

export function HealthProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [serverDown, setServerDown] = useState(false);
  const [checking, setChecking] = useState(true);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const h = await api.health();
      setHealth(h);
      setServerDown(false);
    } catch (e) {
      if (isNetworkError(e)) setServerDown(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      await refresh();
      if (cancelled) return;
      timer.current = window.setTimeout(tick, serverDown ? POLL_DOWN_MS : POLL_OK_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer.current) window.clearTimeout(timer.current);
    };
    // serverDown is intentionally read at schedule time; restarting the loop on change is fine.
  }, [refresh, serverDown]);

  const value = useMemo(() => ({ health, serverDown, checking, refresh }), [health, serverDown, checking, refresh]);
  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>;
}

export function useHealth(): HealthState {
  const ctx = useContext(HealthContext);
  if (!ctx) throw new Error('useHealth must be used inside HealthProvider');
  return ctx;
}
