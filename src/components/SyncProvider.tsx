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

/**
 * Ход импорта отчёта MetaTrader.
 *
 * `upload` — файл уходит на сервер, процент известен точно; `processing` —
 * сервер разбирает отчёт и пишет сделки, сколько это займёт заранее не
 * известно, поэтому фаза показывается «бегущей» полосой без процентов.
 */
export type ImportProg = { phase: "upload" | "processing"; loaded: number; total: number };

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
  /** Импорты отчётов, идущие прямо сейчас, по id аккаунта. */
  importing: Record<string, ImportProg>;
  importReport: (accountId: string, file: File) => Promise<void>;
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
  const [importing, setImporting] = useState<Record<string, ImportProg>>({});
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

  /**
   * Импорт отчёта MetaTrader. Живёт здесь, а не на странице счетов, ровно по
   * той же причине, что и синк: провайдер смонтирован в layout дашборда, и
   * загрузка продолжается, когда пользователь уходит на другую страницу — на
   * самой странице запрос обрывался бы вместе с её размонтированием.
   *
   * XMLHttpRequest, а не fetch: нужен прогресс ОТПРАВКИ файла, а fetch его не
   * отдаёт (upload-стримы в браузерах пока недоступны без ReadableStream-дуплекса).
   */
  const importReport = useCallback(
    (accountId: string, file: File) =>
      new Promise<void>((resolve) => {
        if (importing[accountId]) return resolve();
        setImporting((s) => ({ ...s, [accountId]: { phase: "upload", loaded: 0, total: file.size } }));

        const fd = new FormData();
        fd.append("file", file);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/accounts/${accountId}/import`);

        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          setImporting((s) => ({
            ...s,
            [accountId]: { phase: "upload", loaded: e.loaded, total: e.total },
          }));
        };
        // Файл ушёл целиком — дальше сервер разбирает отчёт и пишет сделки.
        xhr.upload.onload = () => {
          setImporting((s) => ({
            ...s,
            [accountId]: { phase: "processing", loaded: file.size, total: file.size },
          }));
        };

        const finish = (message: string | null) => {
          setImporting((s) => {
            const next = { ...s };
            delete next[accountId];
            return next;
          });
          if (message) setNotice(message);
          setCompletedAt(Date.now());
          resolve();
        };

        xhr.onload = () => {
          let data: { error?: string; imported?: number; skipped?: number } = {};
          try {
            data = JSON.parse(xhr.responseText);
          } catch {
            // Пустой или битый ответ — сообщение ниже всё равно осмысленное.
          }
          finish(
            xhr.status >= 200 && xhr.status < 300
              ? t("acc.mt.imported", { n: data.imported ?? 0, skipped: data.skipped ?? 0 })
              : (data.error ?? t("settings.saveError")),
          );
        };
        xhr.onerror = () => finish(t("settings.saveError"));
        xhr.onabort = () => finish(null);
        xhr.send(fd);
      }),
    [importing, t],
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
      // Свёрнутую или фоновую вкладку не дёргаем — так же, как страницы
      // графиков. Провайдер живёт в layout кабинета, то есть тик шёл раз в
      // минуту с ЛЮБОЙ открытой страницы, включая забытую в другой вкладке.
      // Ничего не теряем: следующий тик после возврата всё равно поднимет
      // просроченный авто-синк, он определяется по lastSyncAt, а не по счётчику.
      if (document.hidden) return;
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

  // Переход между страницами дашборда импорт переживает (провайдер живёт в
  // layout), а вот перезагрузка или закрытие вкладки его оборвёт — на этот
  // случай браузер спросит подтверждение.
  useEffect(() => {
    if (Object.keys(importing).length === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Текст своим сообщением браузеры давно не показывают, но сам факт
      // непустого returnValue включает системный диалог.
      e.returnValue = t("acc.mt.import.leaveWarning");
      return e.returnValue;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [importing, t]);

  const anySyncing = Object.keys(syncing).length > 0;

  return (
    <SyncCtx.Provider
      value={{
        progress,
        importing,
        importReport,
        syncing,
        anySyncing,
        completedAt,
        notice,
        setNotice,
        syncAccount,
        syncAll,
      }}
    >
      {children}
    </SyncCtx.Provider>
  );
}
