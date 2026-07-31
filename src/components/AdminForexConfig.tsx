"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2, Plus, AlertTriangle } from "lucide-react";

// Внутренняя админ-панель (RU) — управление списком валютных пар
// forex-collector (без передеплоя) и ручная очистка истории свечей.
// Пишет в /api/admin/forex/config и /api/admin/forex/purge.

type ConfigItem = { symbol: string; enabled: boolean; updatedAt: string };

function SymbolsConfig() {
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [envSymbols, setEnvSymbols] = useState<string[]>([]);
  const [newSymbol, setNewSymbol] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [cfgRes, statusRes] = await Promise.all([
      fetch("/api/admin/forex/config"),
      fetch("/api/admin/forex"),
    ]);
    if (cfgRes.ok) setItems((await cfgRes.json()).items ?? []);
    if (statusRes.ok) setEnvSymbols((await statusRes.json()).envSymbols ?? []);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [cfgRes, statusRes] = await Promise.all([
        fetch("/api/admin/forex/config"),
        fetch("/api/admin/forex"),
      ]);
      if (!alive) return;
      if (cfgRes.ok) setItems((await cfgRes.json()).items ?? []);
      if (statusRes.ok) setEnvSymbols((await statusRes.json()).envSymbols ?? []);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function addSymbol() {
    const symbol = newSymbol.trim().toUpperCase();
    if (!symbol) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/forex/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const d = await res.json();
      if (res.ok) {
        setItems(d.items ?? []);
        setNewSymbol("");
        setMsg("Добавлено. Коллектор подключится и начнёт бэкафилл истории в течение ~60с.");
      } else {
        setMsg(`Ошибка: ${d.error ?? res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleSymbol(symbol: string, enabled: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/forex/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, enabled }),
      });
      const d = await res.json();
      if (res.ok) setItems(d.items ?? []);
      else setMsg(`Ошибка: ${d.error ?? res.status}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeSymbol(symbol: string) {
    if (!confirm(`Удалить пару ${symbol} из конфигурации? Коллектор перестанет её собирать (уже записанная история в FxCandle останется — чистить отдельно ниже).`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/forex/config?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
      const d = await res.json();
      if (res.ok) setItems(d.items ?? []);
      else setMsg(`Ошибка: ${d.error ?? res.status}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-lg font-medium">Валютные пары</h2>
      <p className="mt-1 text-sm text-muted">
        Коллектор перечитывает этот список раз в ~60с — добавление/удаление пары не требует передеплоя.
        Если список ниже пуст, коллектор использует пары из ENV <code className="text-xs">FX_SYMBOLS</code> по умолчанию:{" "}
        <span className="text-fg">{envSymbols.join(", ") || "—"}</span>.
      </p>

      <div className="mt-4 card p-4 max-w-xl space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="EUR/USD"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSymbol()}
            className="input-base text-sm py-1.5 flex-1"
          />
          <button
            disabled={!newSymbol.trim() || busy}
            onClick={addSymbol}
            className="input-base text-sm py-1.5 px-3 inline-flex items-center gap-1.5 hover:border-border-strong disabled:opacity-40"
          >
            <Plus size={14} /> Добавить
          </button>
        </div>

        {items.length > 0 ? (
          <div className="divide-y divide-border/30">
            {items.map((it) => (
              <div key={it.symbol} className="flex items-center gap-3 py-2 text-sm">
                <label className="flex items-center gap-2 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={it.enabled}
                    onChange={(e) => toggleSymbol(it.symbol, e.target.checked)}
                    className="accent-accent"
                  />
                  <span className={it.enabled ? "text-fg" : "text-faint line-through"}>{it.symbol}</span>
                </label>
                <button
                  onClick={() => removeSymbol(it.symbol)}
                  className="text-faint hover:text-loss p-1"
                  title="Удалить"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-faint">Конфигурация пуста — используются пары из ENV FX_SYMBOLS.</div>
        )}
        {msg && <div className="text-xs text-muted">{msg}</div>}
      </div>
    </section>
  );
}

function PurgeCandles() {
  const [range, setRange] = useState<{ oldest: string | null; newest: string | null }>({ oldest: null, newest: null });
  const [before, setBefore] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/forex/purge");
    if (res.ok) setRange(await res.json());
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/admin/forex/purge");
      if (res.ok && alive) setRange(await res.json());
    })();
    return () => {
      alive = false;
    };
  }, []);

  const presetMonths = (n: number): string | null => {
    if (!range.oldest) return null;
    const d = new Date(range.oldest);
    d.setMonth(d.getMonth() + n);
    return d.toISOString();
  };

  async function purge(beforeIso: string) {
    if (!beforeIso) return;
    const human = new Date(beforeIso).toLocaleString("ru-RU");
    if (!confirm(`Удалить все свечи форекса старше ${human}? Действие необратимо.`)) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/forex/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ before: beforeIso }),
      });
      const d = await res.json();
      if (res.ok) {
        setResult(`Удалено свечей: ${d.deleted}.`);
        await load();
      } else {
        setResult(`Ошибка: ${d.error ?? res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ru-RU") : "—");

  return (
    <section>
      <h2 className="text-lg font-medium">Очистка истории свечей</h2>
      <p className="mt-1 text-sm text-muted">
        Автоочистка уже идёт по <code className="text-xs">FX_CANDLE_RETENTION_DAYS</code> (по умолчанию 365 дней).
        Здесь можно почистить раньше срока вручную (например, после смены источника данных).
      </p>
      <div className="mt-2 text-xs text-faint">
        Данные в БД: с <b className="text-fg">{fmt(range.oldest)}</b> по <b className="text-fg">{fmt(range.newest)}</b>
      </div>

      <div className="mt-4 card p-4 max-w-xl space-y-3">
        <div className="flex flex-wrap gap-2">
          {([["первый месяц", 1], ["первые 3 месяца", 3], ["первые 6 месяцев", 6]] as const).map(([label, n]) => {
            const iso = presetMonths(n);
            return (
              <button
                key={n}
                disabled={!iso || busy}
                onClick={() => iso && purge(iso)}
                className="input-base text-sm py-1.5 px-3 hover:border-border-strong disabled:opacity-40"
              >
                Удалить {label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">или до даты:</span>
          <input
            type="datetime-local"
            className="input-base text-sm py-1.5"
            value={before}
            onChange={(e) => setBefore(e.target.value)}
          />
          <button
            disabled={!before || busy}
            onClick={() => before && purge(new Date(before).toISOString())}
            className="input-base text-sm py-1.5 px-3 inline-flex items-center gap-1.5 text-loss border-loss/40 hover:border-loss disabled:opacity-40"
          >
            <AlertTriangle size={14} /> Удалить
          </button>
        </div>
        {result && <div className="text-xs text-muted">{result}</div>}
      </div>
    </section>
  );
}

export default function AdminForexConfig() {
  return (
    <div className="mt-8 space-y-8">
      <SymbolsConfig />
      <PurgeCandles />
    </div>
  );
}
