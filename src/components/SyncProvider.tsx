"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useI18n } from "@/lib/i18n/provider";

// Live per-account scan progress, mirrored from the chunked sync endpoint.
export type SyncProg = { done: number; total: number; imported: number; phase: string | null };

type SyncAccount = {
  id: string;
  source: string;
  autoSync: boolean;
  syncIntervalMinutes: number;
  syncStatus: string;
  lastSyncAt: string | null;
};

type Ctx = {
  progress: Record<string, SyncProg>;
  syncing: Record<string, boolean>;
  anySyncing: boolean;
  // Bumped (to Date.now()) whenever any account scan finishes, so pages can
  // refetch their data once new fills have landed.
  completedAt: number;
  notice: string | null;
  setNotice: (n: string | null) => void;
  syncAccount: (id: string, rescan?: boolean) => Promise<void>;
  syncAll: () => Promise<void>;
};

const SyncCtx = createContext<Ctx | null>(null);

export function useSync(): Ctx {
  const c = useContext(SyncCtx);
  if (!c) throw new Error("useSync must be used within <SyncProvider>");
  return c;
}

const isMt = (s: string) => s === "mt4" || s === "mt5";

// Drives chunked exchange syncs from a single place that lives in the dashboard
// layout — so a running scan keeps advancing while the user navigates between
// dashboard pages (the loop no longer dies when the accounts page unmounts).
// Also runs a lightweight client-side scheduler that kicks off due auto-syncs
// (and resumes interrupted scans) while any dashboard page is open.
export default function SyncProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [progress, setProgress] = useState<Record<string, SyncProg>>({});
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [completedAt, setCompletedAt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // Account ids whose chunk loop is currently running in this tab.
  const running = useRef<Set<string>>(new Set());

  const syncAccount = useCallback(
    async (id: string, rescan = false) => {
      if (running.current.has(id)) return;
      running.current.add(id);
      setSyncing((s) => ({ ...s, [id]: true }));
      const post = (body: object) =>
        fetch(`/api/accounts/${id}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      try {
        let res = await post({ rescan });
        let data = await res.json();
        let guard = 0;
        while (res.ok && data.status === "syncing" && guard < 500) {
          guard++;
          setProgress((p) => ({
            ...p,
            [id]: { done: data.done, total: data.total, imported: data.imported, phase: data.phase },
          }));
          res = await post({});
          data = await res.json();
        }
        setProgress((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
        if (!res.ok) setNotice(data.error ?? t("settings.saveError"));
        else setNotice(t("acc.notice.scanned", { imported: data.imported ?? 0, total: data.total ?? 0 }));
      } catch {
        // Network blip — leave the partial scan to resume on the next tick.
      } finally {
        running.current.delete(id);
        setSyncing((s) => {
          const next = { ...s };
          delete next[id];
          return next;
        });
        setCompletedAt(Date.now());
      }
    },
    [t],
  );

  const syncAll = useCallback(async () => {
    const res = await fetch("/api/accounts");
    if (!res.ok) return;
    const accs = (await res.json()) as SyncAccount[];
    const ids = accs.filter((a) => !isMt(a.source)).map((a) => a.id);
    await Promise.all(ids.map((id) => syncAccount(id)));
  }, [syncAccount]);

  // Client-side scheduler: while a dashboard page is open, resume any scan that
  // was already in progress and start due auto-syncs at their configured
  // interval (the server cron can't fire often enough on its own).
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/accounts");
        if (!res.ok || cancelled) return;
        const accs = (await res.json()) as SyncAccount[];
        const now = Date.now();
        for (const a of accs) {
          if (isMt(a.source) || running.current.has(a.id)) continue;
          const lastMs = a.lastSyncAt ? new Date(a.lastSyncAt).getTime() : 0;
          const due =
            a.syncStatus === "syncing" ||
            (a.autoSync && (!lastMs || now - lastMs >= a.syncIntervalMinutes * 60_000));
          if (due) void syncAccount(a.id);
        }
      } catch {
        // ignore — retried on the next tick
      }
    }
    void tick();
    const iv = setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [syncAccount]);

  const anySyncing = Object.keys(syncing).length > 0;

  return (
    <SyncCtx.Provider
      value={{ progress, syncing, anySyncing, completedAt, notice, setNotice, syncAccount, syncAll }}
    >
      {children}
    </SyncCtx.Provider>
  );
}
