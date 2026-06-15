"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  RefreshCw,
  Trash2,
  Database,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  X,
} from "lucide-react";
import { fmtDate } from "@/lib/format";
import { Term } from "@/components/Term";
import { useI18n } from "@/lib/i18n/provider";

type Account = {
  id: string;
  exchange: string;
  label: string;
  marketType: string;
  apiKeyMasked: string;
  lastSyncAt: string | null;
  syncStatus: string;
  syncError: string | null;
  autoSync: boolean;
  syncIntervalMinutes: number;
  fillCount: number;
};

const INTERVALS = [15, 30, 60, 240, 720, 1440];

const EXCHANGES = [
  { id: "binance", name: "Binance", needsPassphrase: false },
  { id: "bybit", name: "Bybit", needsPassphrase: false },
  { id: "okx", name: "OKX", needsPassphrase: true },
];

export default function AccountsPage() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/accounts");
    if (res.ok) setAccounts(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function marketLabel(m: string): string {
    if (m === "spot") return t("acc.market.spot");
    if (m === "futures") return t("acc.market.futures");
    return t("acc.market.both");
  }

  async function syncAccount(id: string) {
    setBusy(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/accounts/${id}/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) setNotice(data.error ?? t("settings.saveError"));
      else
        setNotice(
          t("acc.notice.imported", { imported: data.imported, fetched: data.fetched }) +
            (data.errors?.length ? t("acc.notice.warnings", { n: data.errors.length }) : ""),
        );
    } finally {
      setBusy(null);
      load();
    }
  }

  async function seedDemo(id: string) {
    setBusy(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/accounts/${id}/demo`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) setNotice(data.error ?? t("settings.saveError"));
      else setNotice(t("acc.notice.demo", { n: data.imported }));
    } finally {
      setBusy(null);
      load();
    }
  }

  async function remove(id: string) {
    if (!confirm(t("acc.confirmDelete"))) return;
    setBusy(id);
    await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    setBusy(null);
    load();
  }

  async function updateAuto(
    id: string,
    patch: Partial<Pick<Account, "autoSync" | "syncIntervalMinutes">>,
  ) {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }

  return (
    <div className="px-6 py-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold">{t("acc.title")}</h1>
          <p className="text-sm text-muted">{t("acc.subtitle")}</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition"
        >
          <Plus size={16} />
          {t("acc.add")}
        </button>
      </div>

      <div className="card p-3 mb-5 flex items-start gap-3 text-sm text-muted">
        <ShieldCheck size={18} className="text-profit shrink-0 mt-0.5" />
        <p>{t("acc.security")}</p>
      </div>

      {notice && (
        <div className="card p-3 mb-5 text-sm flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-faint hover:text-fg">
            <X size={16} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-faint">{t("common.loading")}</div>
      ) : accounts.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-muted mb-4">{t("acc.empty")}</p>
          <button
            onClick={() => setShowForm(true)}
            className="px-5 py-2.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition"
          >
            {t("acc.connectFirst")}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => (
            <div key={a.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <ExchangeBadge exchange={a.exchange} />
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {a.label}
                      <StatusPill status={a.syncStatus} />
                    </div>
                    <div className="text-xs text-faint">
                      {marketLabel(a.marketType)} · {a.apiKeyMasked} ·{" "}
                      {t("acc.fillsCount", { n: a.fillCount })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => seedDemo(a.id)}
                    disabled={busy === a.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg input-base text-sm hover:border-border-strong disabled:opacity-50"
                  >
                    <Database size={14} />
                    {t("acc.demo")}
                  </button>
                  <button
                    onClick={() => syncAccount(a.id)}
                    disabled={busy === a.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/15 text-accent text-sm hover:bg-accent/25 disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={busy === a.id ? "animate-spin" : ""} />
                    {t("acc.sync")}
                  </button>
                  <button
                    onClick={() => remove(a.id)}
                    disabled={busy === a.id}
                    className="p-1.5 rounded-lg text-faint hover:text-loss hover:bg-surface-2 disabled:opacity-50"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-faint">
                <span>
                  {t("acc.lastSync")} {a.lastSyncAt ? fmtDate(a.lastSyncAt) : t("acc.never")}
                </span>
                {a.syncError && (
                  <span className="text-loss truncate max-w-md" title={a.syncError}>
                    {a.syncError}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border text-xs">
                <button
                  onClick={() => updateAuto(a.id, { autoSync: !a.autoSync })}
                  aria-pressed={a.autoSync}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                    a.autoSync ? "bg-accent" : "bg-surface-2 border border-border"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition ${
                      a.autoSync ? "translate-x-4" : "translate-x-1"
                    }`}
                  />
                </button>
                <span className={a.autoSync ? "text-fg" : "text-muted"}>
                  {t("acc.autoSync")}
                </span>
                <span className="text-faint">{t("acc.every")}</span>
                <select
                  value={a.syncIntervalMinutes}
                  disabled={!a.autoSync}
                  onChange={(e) =>
                    updateAuto(a.id, { syncIntervalMinutes: Number(e.target.value) })
                  }
                  className="input-base py-1 text-xs cursor-pointer disabled:opacity-50"
                >
                  {INTERVALS.map((v) => (
                    <option key={v} value={v}>
                      {t(`acc.interval.${v}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <AccountForm
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function AccountForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [exchange, setExchange] = useState("binance");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [marketType, setMarketType] = useState("both");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const needsPassphrase = EXCHANGES.find((e) => e.id === exchange)?.needsPassphrase;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange,
          label,
          apiKey,
          apiSecret,
          passphrase: needsPassphrase ? passphrase : undefined,
          marketType,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("settings.saveError"));
        return;
      }
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t("acc.form.title")}</h2>
          <button onClick={onClose} className="text-faint hover:text-fg">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs text-muted mb-1">{t("acc.form.exchange")}</label>
            <select
              className="input-base w-full cursor-pointer"
              value={exchange}
              onChange={(e) => setExchange(e.target.value)}
            >
              {EXCHANGES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">{t("acc.form.label")}</label>
            <input
              className="input-base w-full"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("acc.form.labelPlaceholder")}
              required
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">{t("acc.form.markets")}</label>
            <select
              className="input-base w-full cursor-pointer"
              value={marketType}
              onChange={(e) => setMarketType(e.target.value)}
            >
              <option value="both">{t("acc.market.both")}</option>
              <option value="spot">{t("acc.market.spot")}</option>
              <option value="futures">{t("acc.market.futures")}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">
              <Term name="API Key">API Key</Term>
            </label>
            <input
              className="input-base w-full font-mono text-xs"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">
              <Term name="API Secret">API Secret</Term>
            </label>
            <input
              type="password"
              className="input-base w-full font-mono text-xs"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          {needsPassphrase && (
            <div>
              <label className="block text-xs text-muted mb-1">
                <Term name="Passphrase">Passphrase</Term>
              </label>
              <input
                type="password"
                className="input-base w-full font-mono text-xs"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
          )}

          {error && (
            <div className="text-sm text-loss bg-loss/10 border border-loss/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("acc.form.connect")}
          </button>
        </form>
      </div>
    </div>
  );
}

function ExchangeBadge({ exchange }: { exchange: string }) {
  const colors: Record<string, string> = {
    binance: "bg-warn/15 text-warn",
    bybit: "bg-accent/15 text-accent",
    okx: "bg-fg/10 text-fg",
  };
  return (
    <span
      className={`inline-flex h-10 w-10 items-center justify-center rounded-lg font-semibold uppercase text-xs ${
        colors[exchange] ?? "bg-surface-2 text-muted"
      }`}
    >
      {exchange.slice(0, 3)}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-loss">
        <AlertTriangle size={12} /> {t("acc.status.error")}
      </span>
    );
  if (status === "syncing")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warn">
        <RefreshCw size={12} className="animate-spin" /> {t("acc.status.syncing")}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-profit">
      <CheckCircle2 size={12} /> {t("acc.status.ok")}
    </span>
  );
}
