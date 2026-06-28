"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, RotateCcw, AlertTriangle } from "lucide-react";
import clsx from "clsx";

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
      if (!res.ok) alert(json.error ?? "Ошибка");
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
              <th className="px-5 py-2 font-medium">Пользователь</th>
              <th className="px-3 py-2 font-medium">Биржа / метка</th>
              <th className="px-3 py-2 font-medium">Источник</th>
              <th className="px-3 py-2 font-medium">Статус</th>
              <th className="px-3 py-2 font-medium text-right">Fills / импорт</th>
              <th className="px-3 py-2 font-medium">Авто-синк</th>
              <th className="px-3 py-2 font-medium">Послед. синк</th>
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
                  {r.fills.toLocaleString("ru-RU")} / {r.importedTrades.toLocaleString("ru-RU")}
                </td>
                <td className="px-3 py-2.5">
                  {r.autoSync ? (
                    <span className="text-profit text-xs">вкл · {r.syncIntervalMinutes}м</span>
                  ) : (
                    <span className="text-faint text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-muted whitespace-nowrap text-xs">
                  {r.lastSyncAt ? new Date(r.lastSyncAt).toLocaleString("ru-RU") : "—"}
                </td>
                <td className="px-5 py-2.5 text-right whitespace-nowrap">
                  <div className="inline-flex gap-1">
                    {r.source === "exchange" && (
                      <button
                        onClick={() => act(r.id, "sync")}
                        disabled={busy !== null}
                        title="Запустить синхронизацию (один чанк)"
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted hover:text-accent hover:bg-surface-2 transition disabled:opacity-50"
                      >
                        <RefreshCw size={13} className={clsx(busy === r.id + "sync" && "animate-spin")} /> синк
                      </button>
                    )}
                    {r.syncStatus === "syncing" && (
                      <button
                        onClick={() => act(r.id, "reset")}
                        disabled={busy !== null}
                        title="Сбросить зависший статус в idle"
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted hover:text-fg hover:bg-surface-2 transition disabled:opacity-50"
                      >
                        <RotateCcw size={13} /> сброс
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-muted">Аккаунтов нет.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
