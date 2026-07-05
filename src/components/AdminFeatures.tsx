"use client";

import { useEffect, useState } from "react";

// Вкл/выкл + числовые лимиты для опциональных фич (генерируется из
// src/lib/features.ts — новая фича появляется здесь без правок компонента).

type FeatureRow = {
  key: string;
  label: string;
  value: { enabled: boolean } & Record<string, unknown>;
};

export default function AdminFeatures() {
  const [rows, setRows] = useState<FeatureRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/admin/features");
      if (res.ok && alive) {
        const rows: FeatureRow[] = (await res.json()).features ?? [];
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
      if (res.ok) setRows((await res.json()).features ?? []);
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
    <div className="mt-6 max-w-xl space-y-3">
      {rows.map((r) => {
        const numericFields = Object.entries(r.value).filter(([k]) => k !== "enabled");
        return (
          <div key={r.key} className="card p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">{r.label}</div>
                <div className="text-xs text-faint">{r.key}</div>
              </div>
              <Switch
                on={r.value.enabled}
                disabled={busy === r.key}
                onClick={() => patch(r.key, { enabled: !r.value.enabled })}
              />
            </div>
            {numericFields.length > 0 && (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                {numericFields.map(([field]) => (
                  <label key={field} className="text-xs text-faint">
                    {field}
                    <input
                      type="number"
                      className="mt-1 block w-24 input-base px-2 py-1 text-sm"
                      value={drafts[r.key]?.[field] ?? ""}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [r.key]: { ...d[r.key], [field]: e.target.value } }))
                      }
                    />
                  </label>
                ))}
                <button
                  onClick={() => saveConfig(r.key)}
                  disabled={busy === r.key}
                  className="input-base px-3 py-1.5 text-sm hover:border-border-strong disabled:opacity-50"
                >
                  Сохранить
                </button>
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
