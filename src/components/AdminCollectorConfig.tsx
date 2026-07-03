"use client";

import { useCallback, useEffect, useState } from "react";
import { Save, Trash2, Plus, AlertTriangle } from "lucide-react";

// Внутренняя админ-панель (RU) — пороги «только крупные лимитки» и ручная
// очистка истории карты ордеров. Пишет в /api/admin/collector/config и /purge.

type Item = { symbol: string; minCoins: number; updatedAt?: string };

const baseAsset = (s: string) => s.toUpperCase().replace(/(USDT|USDC|BUSD|USD|FDUSD)$/i, "") || s;

export default function AdminCollectorConfig() {
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/collector/config");
    if (res.ok) setItems((await res.json()).items ?? []);
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/admin/collector/config");
      if (res.ok && alive) setItems((await res.json()).items ?? []);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setRow = (i: number, patch: Partial<Item>) =>
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addRow = () => setItems((xs) => [...xs, { symbol: "", minCoins: 0 }]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        items: items
          .filter((x) => x.symbol.trim() && x.minCoins > 0)
          .map((x) => ({ symbol: x.symbol.trim().toUpperCase(), minCoins: Number(x.minCoins) })),
      };
      const res = await fetch("/api/admin/collector/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setItems((await res.json()).items ?? []);
        setMsg("Сохранено. Коллектор подхватит в течение ~30с.");
      } else {
        setMsg(`Ошибка: ${(await res.json()).error ?? res.status}`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(symbol: string) {
    if (symbol) await fetch(`/api/admin/collector/config?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="mt-8 space-y-8">
      {/* Пороги «только крупные лимитки» */}
      <section>
        <h2 className="text-lg font-medium">Пороги «только крупные лимитки»</h2>
        <p className="mt-1 text-sm text-muted">
          Коллектор записывает уровень стакана, только если суммарный размер (bid+ask) на этой цене
          не меньше порога — в монетах базового актива. Больше порог → меньше данных и нагрузки на диск.
          Читается коллектором каждые ~30&nbsp;с, редеплой не нужен.
        </p>
        <div className="mt-4 card p-4 max-w-xl">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-faint mb-1">
            <span>Символ</span>
            <span>Мин. размер (монет)</span>
            <span />
          </div>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center mb-2">
              <input
                className="input-base text-sm py-1.5 uppercase"
                value={it.symbol}
                placeholder="BTCUSDT"
                onChange={(e) => setRow(i, { symbol: e.target.value })}
              />
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="input-base text-sm py-1.5 w-full"
                  value={it.minCoins}
                  onChange={(e) => setRow(i, { minCoins: Number(e.target.value) })}
                />
                <span className="text-xs text-faint w-10 shrink-0">{it.symbol ? baseAsset(it.symbol) : ""}</span>
              </div>
              <button
                onClick={() => removeRow(it.symbol.trim().toUpperCase())}
                className="input-base p-1.5 text-muted hover:text-loss"
                title="Удалить (вернётся к дефолту коллектора)"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 mt-3">
            <button onClick={addRow} className="input-base text-sm py-1.5 px-3 inline-flex items-center gap-1.5 hover:border-border-strong">
              <Plus size={14} /> Символ
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="input-base text-sm py-1.5 px-3 inline-flex items-center gap-1.5 text-accent border-accent/40 hover:border-accent disabled:opacity-50"
            >
              <Save size={14} /> Сохранить
            </button>
            {msg && <span className="text-xs text-muted">{msg}</span>}
          </div>
        </div>
      </section>

      <PurgeHistory />
    </div>
  );
}

function PurgeHistory() {
  const [range, setRange] = useState<{ oldest: string | null; newest: string | null }>({ oldest: null, newest: null });
  const [before, setBefore] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/collector/purge");
    if (res.ok) setRange(await res.json());
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/admin/collector/purge");
      if (res.ok && alive) setRange(await res.json());
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Пресеты: «первые N месяцев» = удалить всё старше (самая старая дата + N мес.).
  const presetMonths = (n: number): string | null => {
    if (!range.oldest) return null;
    const d = new Date(range.oldest);
    d.setMonth(d.getMonth() + n);
    return d.toISOString();
  };

  async function purge(beforeIso: string) {
    if (!beforeIso) return;
    const human = new Date(beforeIso).toLocaleString("ru-RU");
    if (!confirm(`Удалить всю историю карты ордеров старше ${human}? Действие необратимо.`)) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/collector/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ before: beforeIso }),
      });
      const d = await res.json();
      if (res.ok) {
        setResult(`Удалено строк: ${d.total}. `);
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
      <h2 className="text-lg font-medium">Очистка истории карты ордеров</h2>
      <p className="mt-1 text-sm text-muted">
        Автоочистки истории (rollup, сделки, футпринт, крупные сделки) нет — она копится, пока диск позволяет.
        Здесь можно удалить старые данные вручную. Сырые снапшоты чистятся коллектором по ретеншену отдельно.
      </p>
      <div className="mt-2 text-xs text-faint">
        Данные в БД: с <b className="text-fg">{fmt(range.oldest)}</b> по <b className="text-fg">{fmt(range.newest)}</b>
      </div>

      <div className="mt-4 card p-4 max-w-xl space-y-3">
        <div className="flex flex-wrap gap-2">
          {([["первый месяц", 1], ["первые 3 месяца", 3], ["первые 6 месяцев", 6], ["первый год", 12]] as const).map(
            ([label, n]) => {
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
            },
          )}
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
