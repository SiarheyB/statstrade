"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, RotateCcw, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";

type Row = {
  id: string;
  userEmail: string;
  exchange: string;
  label: string;
  source: string;
  marketType: string;
  syncStatus: string;
  syncError: string | null;
  lastSyncAt: string | null;
  autoSync: boolean;
  syncIntervalMinutes: number;
  fills: number;
  importedTrades: number;
};

const STATUS_STYLE: Record<string, string> = {
  idle: "text-muted",
  syncing: "text-accent",
  error: "text-loss",
};

export default function AccountsTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const nf = locale === "ru" ? "ru-RU" : "en-US";
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: "reset" | "sync") {
    setBusy(id + action);
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const json = await res.json();
      if (!res.ok) alert(json.error ?? t("admin.accounts.error"));
      else router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-6 card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-faint border-b border-border">
              <th className="px-5 py-2 font-medium">{t("admin.accounts.th.user")}</th>
              <th className="px-3 py-2 font-medium">{t("admin.accounts.th.exchange")}</th>
              <th className="px-3 py-2 font-medium">{t("admin.accounts.th.source")}</th>
              <th className="px-3 py-2 font-medium">{t("admin.accounts.th.status")}</th>
              <th className="px-3 py-2 font-medium text-right">{t("admin.accounts.th.fills")}</th>
              <th className="px-3 py-2 font-medium">{t("admin.accounts.th.autoSync")}</th>
              <th className="px-3 py-2 font-medium">{t("admin.accounts.th.lastSync")}</th>
              <th className="px-5 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50 align-top">
                <td className="px-5 py-2.5 whitespace-nowrap text-muted">{r.userEmail}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className="font-medium">{r.exchange}</span>
                  <span className="text-faint"> · {r.label}</span>
                  <span className="block text-[11px] text-faint">{r.marketType}</span>
                </td>
                <td className="px-3 py-2.5 text-muted">{r.source}</td>
                <td className="px-3 py-2.5">
                  <span className={clsx("capitalize", STATUS_STYLE[r.syncStatus] ?? "text-muted")}>{r.syncStatus}</span>
                  {r.syncError && (
                    <span
                      className="block text-[11px] text-loss/80 max-w-[220px] truncate flex items-center gap-1"
                      title={r.syncError}
                    >
                      <AlertTriangle size={11} className="shrink-0" /> {r.syncError}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                  {r.fills.toLocaleString(nf)} / {r.importedTrades.toLocaleString(nf)}
                </td>
                <td className="px-3 py-2.5">
                  {r.autoSync ? (
                    <span className="text-profit text-xs">{t("admin.accounts.autoOn", { min: r.syncIntervalMinutes })}</span>
                  ) : (
                    <span className="text-faint text-xs">{t("admin.dash")}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-muted whitespace-nowrap text-xs">
                  {r.lastSyncAt ? new Date(r.lastSyncAt).toLocaleString(nf) : t("admin.dash")}
                </td>
                <td className="px-5 py-2.5 text-right whitespace-nowrap">
                  <div className="inline-flex gap-1">
                    {r.source === "exchange" && (
                      <button
                        onClick={() => act(r.id, "sync")}
                        disabled={busy !== null}
                        title={t("admin.accounts.syncTitle")}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted hover:text-accent hover:bg-surface-2 transition disabled:opacity-50"
                      >
                        <RefreshCw size={13} className={clsx(busy === r.id + "sync" && "animate-spin")} /> {t("admin.accounts.sync")}
                      </button>
                    )}
                    {r.syncStatus === "syncing" && (
                      <button
                        onClick={() => act(r.id, "reset")}
                        disabled={busy !== null}
                        title={t("admin.accounts.resetTitle")}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted hover:text-fg hover:bg-surface-2 transition disabled:opacity-50"
                      >
                        <RotateCcw size={13} /> {t("admin.accounts.reset")}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-muted">{t("admin.accounts.none")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
