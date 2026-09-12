"use client";

import { useEffect, useState } from "react";

// Настройки индикаторов карты ордеров (Volume Profile, Divergence Scanner,
// Bid/Ask Imbalance) — раньше жили вперемешку с несвязанными фичами в общем
// списке /admin/features; вынесены на вкладку «Индикаторы» страницы «Карта
// ордеров», где их и ищут. Хранилище то же самое (FeatureConfig, тот же
// /api/admin/features) — просто список сужен до трёх ключей.

type FeatureRow = {
  key: string;
  label: string;
  description: string;
  fieldHelp: Record<string, string>;
  value: { enabled: boolean } & Record<string, unknown>;
};

const KEYS = ["volumeProfile", "divergenceScanner", "imbalanceIndicator"];

export default function AdminIndicators() {
  const [rows, setRows] = useState<FeatureRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/admin/features");
      if (res.ok && alive) {
        const rows: FeatureRow[] = ((await res.json()).features ?? []).filter((r: FeatureRow) =>
          KEYS.includes(r.key),
        );
        setRows(rows);
        setDrafts(
          Object.fromEntries(
            rows.map((r) => [
              r.key,
              Object.fromEntries(
                Object.entries(r.value).filter(([k]) => k !== "enabled").map(([k, v]) => [k, String(v)]),
              ),
            ]),
          ),
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function patch(key: string, body: { enabled?: boolean; config?: Record<string, number> }) {
    setBusy(key);
    try {
      const res = await fetch("/api/admin/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, ...body }),
      });
      if (res.ok) {
        const all: FeatureRow[] = (await res.json()).features ?? [];
        setRows(all.filter((r) => KEYS.includes(r.key)));
        if (body.config) {
          setSaved(key);
          setTimeout(() => setSaved(null), 1500);
        }
      }
    } finally {
      setBusy(null);
    }
  }

  function saveConfig(key: string) {
    const draft = drafts[key] ?? {};
    const config: Record<string, number> = {};
    for (const [k, v] of Object.entries(draft)) {
      const n = Number(v);
      if (Number.isFinite(n)) config[k] = n;
    }
    patch(key, { config });
  }

  return (
    <div className="max-w-2xl space-y-3">
      {rows.map((r) => {
        const numericFields = Object.entries(r.value).filter(([k]) => k !== "enabled");
        return (
          <div key={r.key} className="card p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">{r.label}</div>
                {r.description && (
                  <p className="text-xs text-muted mt-1 leading-relaxed max-w-lg">{r.description}</p>
                )}
              </div>
              <Switch
                on={r.value.enabled}
                disabled={busy === r.key}
                onClick={() => patch(r.key, { enabled: !r.value.enabled })}
              />
            </div>
            <p className="text-[11px] text-faint mt-2">
              {r.value.enabled
                ? "Сейчас включено — видно всем пользователям."
                : "Сейчас выключено — скрыто у всех пользователей, независимо от полей ниже."}
            </p>

            {numericFields.length > 0 && (
              <div className="mt-3 space-y-3 border-t border-border pt-3">
                {numericFields.map(([field]) => (
                  <div key={field} className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{field}</div>
                      {r.fieldHelp[field] && (
                        <p className="text-[11px] text-faint mt-0.5 leading-relaxed max-w-md">{r.fieldHelp[field]}</p>
                      )}
                    </div>
                    <input
                      type="number"
                      className="mt-0.5 w-24 input-base px-2 py-1 text-sm shrink-0"
                      value={drafts[r.key]?.[field] ?? ""}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [r.key]: { ...d[r.key], [field]: e.target.value } }))
                      }
                    />
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => saveConfig(r.key)}
                    disabled={busy === r.key}
                    className="input-base px-3 py-1.5 text-sm hover:border-border-strong disabled:opacity-50"
                  >
                    Сохранить
                  </button>
                  {saved === r.key && <span className="text-xs text-profit">Сохранено</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {rows.length === 0 && <div className="card px-4 py-6 text-sm text-faint">Загрузка…</div>}
    </div>
  );
}

function Switch({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 shrink-0 ${
        on ? "bg-accent" : "bg-surface-2 border border-border"
      }`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white transition ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}
