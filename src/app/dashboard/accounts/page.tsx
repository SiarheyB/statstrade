"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  RefreshCw,
  Trash2,
  Database,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Upload,
  X,
} from "lucide-react";
import { fmtDate, fmtUsd } from "@/lib/format";
import { Term } from "@/components/Term";
import { useI18n } from "@/lib/i18n/provider";

type Account = {
  id: string;
  exchange: string;
  label: string;
  source: string;
  accountCurrency: string;
  importedCount: number;
  marketType: string;
  demoTrading: boolean;
  apiKeyMasked: string | null;
  lastSyncAt: string | null;
  syncStatus: string;
  syncError: string | null;
  syncPhase: string | null;
  syncCursor: number;
  syncTotal: number;
  syncImported: number;
  fullSyncAt: string | null;
  autoSync: boolean;
  syncIntervalMinutes: number;
  fillCount: number;
};

type Prog = { done: number; total: number; imported: number; phase: string | null };

const INTERVALS = [15, 30, 60, 240, 720, 1440];

const EXCHANGES = [
  { id: "binance", name: "Binance", needsPassphrase: false, supportsDemo: true },
  { id: "bybit", name: "Bybit", needsPassphrase: false, supportsDemo: true },
  { id: "okx", name: "OKX", needsPassphrase: true, supportsDemo: true },
  { id: "mt4", name: "MetaTrader 4", needsPassphrase: false, supportsDemo: false },
  { id: "mt5", name: "MetaTrader 5", needsPassphrase: false, supportsDemo: false },
];

const ACCOUNT_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD"];

const isMtSource = (s: string) => s === "mt4" || s === "mt5";

export default function AccountsPage() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, Prog>>({});
  const resumingRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/accounts");
    if (res.ok) setAccounts(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Resume a scan that was already in progress (e.g. started on another device
  // or before a reload) so the progress bar picks up where it left off.
  useEffect(() => {
    for (const a of accounts) {
      if (a.syncStatus === "syncing" && !resumingRef.current.has(a.id)) {
        resumingRef.current.add(a.id);
        void syncAccount(a.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  function marketLabel(m: string): string {
    if (m === "spot") return t("acc.market.spot");
    if (m === "futures") return t("acc.market.futures");
    return t("acc.market.both");
  }

  // Drive a chunked background import: POST repeatedly while status === "syncing",
  // updating the progress bar each chunk, until the scan finishes.
  async function syncAccount(id: string, rescan = false) {
    setBusy(id);
    setNotice(null);
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
    } finally {
      setBusy(null);
      resumingRef.current.delete(id);
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

  // Roll back the last imported report for an MT account.
  async function rollbackImport(id: string) {
    if (!confirm(t("acc.mt.rollbackConfirm"))) return;
    setBusy(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/accounts/${id}/import`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) setNotice(data.error ?? t("settings.saveError"));
      else setNotice(t("acc.mt.rolledBack", { n: data.deleted }));
    } finally {
      setBusy(null);
      load();
    }
  }

  // Import another MetaTrader report into an existing MT account.
  async function importReport(id: string, file: File) {
    setBusy(id);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/accounts/${id}/import`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) setNotice(data.error ?? t("settings.saveError"));
      else setNotice(t("acc.mt.imported", { n: data.imported, skipped: data.skipped }));
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

      <div className="card p-3 mb-5 flex items-start gap-3 text-sm text-muted">
        <RefreshCw size={18} className="text-accent shrink-0 mt-0.5" />
        <p>{t("acc.updateNote")}</p>
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
                      {a.demoTrading && (
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-warn/15 text-warn">
                          demo
                        </span>
                      )}
                      <StatusPill status={a.syncStatus} />
                    </div>
                    <div className="text-xs text-faint">
                      {isMtSource(a.source) ? (
                        <>
                          {a.accountCurrency} · {t("acc.mt.tradesCount", { n: a.importedCount })}
                        </>
                      ) : (
                        <>
                          {marketLabel(a.marketType)} · {a.apiKeyMasked} ·{" "}
                          {t("acc.fillsCount", { n: a.fillCount })}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isMtSource(a.source) ? (
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/15 text-accent text-sm hover:bg-accent/25 cursor-pointer">
                      <input
                        type="file"
                        accept=".htm,.html,.html"
                        className="hidden"
                        disabled={busy === a.id}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) importReport(a.id, f);
                          e.currentTarget.value = "";
                        }}
                      />
                      <Upload size={14} />
                      {t("acc.mt.import")}
                    </label>
                  ) : null}
                  {isMtSource(a.source) && a.importedCount > 0 && (
                    <button
                      onClick={() => rollbackImport(a.id)}
                      disabled={busy === a.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg input-base text-sm hover:border-border-strong disabled:opacity-50"
                    >
                      {t("acc.mt.rollback")}
                    </button>
                  )}
                  {!isMtSource(a.source) && (
                    <>
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
                    </>
                  )}
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
                {a.fullSyncAt && busy !== a.id && (
                  <button
                    onClick={() => syncAccount(a.id, true)}
                    className="text-faint hover:text-accent transition underline-offset-2 hover:underline"
                  >
                    {t("acc.sync.rescan")}
                  </button>
                )}
                {a.syncError && !progress[a.id] && (
                  <span className="text-loss truncate max-w-md" title={a.syncError}>
                    {a.syncError}
                  </span>
                )}
              </div>

              {progress[a.id] && (
                <ProgressBar
                  done={progress[a.id].done}
                  total={progress[a.id].total}
                  imported={progress[a.id].imported}
                  phase={progress[a.id].phase}
                />
              )}

              {!isMtSource(a.source) && (
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
              )}
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
  const [demoTrading, setDemoTrading] = useState(false);
  const [accountCurrency, setAccountCurrency] = useState("USD");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<
    { parsed: number; netTotal: number; symbols: string[]; format: string; deposit: number | null } | null
  >(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isMt = isMtSource(exchange);
  const needsPassphrase = EXCHANGES.find((e) => e.id === exchange)?.needsPassphrase;
  const supportsDemo = EXCHANGES.find((e) => e.id === exchange)?.supportsDemo;

  // Parse the selected report (no DB write) to preview before importing.
  async function pickFile(f: File | null) {
    setFile(f);
    setPreview(null);
    setError(null);
    if (!f) return;
    setPreviewing(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("source", exchange);
      fd.append("accountCurrency", accountCurrency);
      const res = await fetch("/api/mt/preview", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? t("settings.saveError"));
        return;
      }
      setPreview({
        parsed: d.parsed,
        netTotal: d.netTotal,
        symbols: d.symbols,
        format: d.format,
        deposit: d.deposit ?? null,
      });
    } finally {
      setPreviewing(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (isMt) {
        if (!file) {
          setError(t("acc.mt.noFile"));
          return;
        }
        // 1. create the MT account, 2. import the report into it.
        const cRes = await fetch("/api/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exchange, source: exchange, label, accountCurrency }),
        });
        const cData = await cRes.json();
        if (!cRes.ok) {
          setError(cData.error ?? t("settings.saveError"));
          return;
        }
        const fd = new FormData();
        fd.append("file", file);
        const iRes = await fetch(`/api/accounts/${cData.id}/import`, { method: "POST", body: fd });
        const iData = await iRes.json();
        if (!iRes.ok) {
          setError(iData.error ?? t("settings.saveError"));
          return;
        }
        onCreated();
        return;
      }

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
          demoTrading: supportsDemo ? demoTrading : false,
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
              maxLength={60}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("acc.form.labelPlaceholder")}
              required
            />
          </div>
          {isMt ? (
            <>
              <div>
                <label className="block text-xs text-muted mb-1">{t("acc.form.currency")}</label>
                <select
                  className="input-base w-full cursor-pointer"
                  value={accountCurrency}
                  onChange={(e) => {
                    setAccountCurrency(e.target.value);
                    if (file) pickFile(file); // re-preview with the new currency
                  }}
                >
                  {ACCOUNT_CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="rounded-lg bg-surface-2/40 border border-border px-3 py-2.5 text-xs text-muted">
                <div className="font-medium text-fg mb-1">
                  {exchange === "mt4" ? t("acc.mt.help.mt4.title") : t("acc.mt.help.mt5.title")}
                </div>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>{exchange === "mt4" ? t("acc.mt.help.mt4.1") : t("acc.mt.help.mt5.1")}</li>
                  <li>{exchange === "mt4" ? t("acc.mt.help.mt4.2") : t("acc.mt.help.mt5.2")}</li>
                  <li>{exchange === "mt4" ? t("acc.mt.help.mt4.3") : t("acc.mt.help.mt5.3")}</li>
                </ol>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">{t("acc.mt.report")}</label>
                <label className="flex flex-col items-center justify-center gap-1 border border-dashed border-border rounded-lg px-3 py-6 text-sm text-muted cursor-pointer hover:border-border-strong">
                  <Upload size={18} className="text-faint" />
                  <span>{file ? file.name : t("acc.mt.dropzone")}</span>
                  <input
                    type="file"
                    accept=".htm,.html"
                    className="hidden"
                    onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <p className="text-xs text-faint mt-1">{t("acc.mt.dropHint")}</p>
              </div>
              {previewing && <div className="text-xs text-faint">{t("common.loading")}</div>}
              {preview && (
                <div className="rounded-lg bg-surface-2/50 border border-border px-3 py-2 text-xs space-y-1">
                  <div className="font-medium text-fg uppercase">{preview.format}</div>
                  <div>{t("acc.mt.previewTrades", { n: preview.parsed })}</div>
                  <div>
                    {t("acc.mt.previewNet")}{" "}
                    <span className={preview.netTotal >= 0 ? "text-profit" : "text-loss"}>
                      {fmtUsd(preview.netTotal, { sign: true })} {accountCurrency}
                    </span>
                  </div>
                  {preview.deposit != null && (
                    <div>
                      {t("acc.mt.previewDeposit")}{" "}
                      <span className="text-fg">{fmtUsd(preview.deposit)} {accountCurrency}</span>
                    </div>
                  )}
                  <div className="text-faint truncate">{preview.symbols.join(", ")}</div>
                </div>
              )}
            </>
          ) : (
            <>
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
              {supportsDemo && (
                <label className="flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={demoTrading}
                    onChange={(e) => setDemoTrading(e.target.checked)}
                    className="accent-accent h-4 w-4"
                  />
                  {t("acc.form.demo")}
                </label>
              )}
              <div>
                <label className="block text-xs text-muted mb-1">
                  <Term name="API Key">API Key</Term>
                </label>
                <input
                  className="input-base w-full font-mono text-xs"
                  maxLength={256}
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
                  maxLength={256}
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
                    maxLength={128}
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>
              )}
            </>
          )}

          {error && (
            <div className="text-sm text-loss bg-loss/10 border border-loss/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || (isMt && !preview)}
            className="w-full py-2.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition disabled:opacity-50"
          >
            {saving
              ? t("common.saving")
              : isMt && preview
                ? t("acc.mt.importN", { n: preview.parsed })
                : isMt
                  ? t("acc.mt.import")
                  : t("acc.form.connect")}
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

function ProgressBar({
  done,
  total,
  imported,
  phase,
}: {
  done: number;
  total: number;
  imported: number;
  phase: string | null;
}) {
  const { t } = useI18n();
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="inline-flex items-center gap-1.5 text-accent font-medium">
          <RefreshCw size={12} className="animate-spin" />
          {phase === "incremental" ? t("acc.sync.incremental") : t("acc.sync.full")}
        </span>
        <span className="font-mono text-faint tabular-nums">
          {done}/{total} {t("acc.sync.pairs")} · {imported} {t("common.trades")} · {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-surface-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent/60 to-accent transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      {phase !== "incremental" && (
        <p className="mt-1.5 text-xs text-faint leading-snug">{t("acc.sync.hint")}</p>
      )}
    </div>
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
