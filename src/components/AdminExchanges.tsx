"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Save, RotateCcw } from "lucide-react";
import { SUPPORTED_EXCHANGES, type ExchangeId } from "@/lib/exchangeIds";

// Тумблеры вкл/выкл бирж для синхронизации аккаунтов + гайды подключения для
// каждой биржи. Выключенная биржа пропадает из формы добавления аккаунта; уже
// подключённые аккаунты и карты ордеров/ликвидаций не затрагиваются.

type Row = {
  id: string;
  name: string;
  needsPassphrase: boolean;
  supportsDemo: boolean;
  enabled: boolean;
  demoEnabled: boolean;
};

export default function AdminExchanges() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Guide editor state
  const [guides, setGuides] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [guideSuccess, setGuideSuccess] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [exRes, guideRes] = await Promise.all([
        fetch("/api/admin/exchanges"),
        fetch("/api/admin/exchange-guides"),
      ]);
      if (exRes.ok && alive) setRows((await exRes.json()).exchanges ?? []);
      if (guideRes.ok && alive) {
        const d = await guideRes.json();
        setGuides(d.guides ?? {});
        setEdits(d.guides ?? {});
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function toggle(id: string, patch: { enabled?: boolean; demoEnabled?: boolean }) {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/exchanges", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exchange: id, ...patch }),
      });
      if (res.ok) setRows((await res.json()).exchanges ?? []);
    } finally {
      setBusy(null);
    }
  }

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleEditGuide = (id: string, value: string) => {
    setEdits((prev) => ({ ...prev, [id]: value }));
    setDirty((prev) => new Set(prev).add(id));
  };

  const handleSaveGuide = async (id: string) => {
    setSaving(id);
    setGuideError(null);
    setGuideSuccess(null);
    try {
      const res = await fetch("/api/admin/exchange-guides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exchangeId: id, guide: edits[id] ?? "" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Ошибка сохранения (${res.status})`);
      }
      // Update local state
      setGuides((prev) => ({ ...prev, [id]: edits[id] ?? "" }));
      setDirty((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setGuideSuccess(`Гайд для ${SUPPORTED_EXCHANGES[id as ExchangeId]?.name ?? id} сохранён`);
    } catch (err: any) {
      setGuideError(err.message || "Не удалось сохранить гайд");
    } finally {
      setSaving(null);
    }
  };

  const handleResetGuide = async (id: string) => {
    if (!confirm(`Сбросить гайд для ${SUPPORTED_EXCHANGES[id as ExchangeId]?.name ?? id} к значению по умолчанию?`)) return;
    setSaving(id);
    setGuideError(null);
    setGuideSuccess(null);
    try {
      // Reload from server to get the default
      const res = await fetch("/api/admin/exchange-guides");
      if (res.ok) {
        const d = await res.json();
        const freshGuides = d.guides ?? {};
        // Reset this exchange's edit back to the fresh value
        setEdits((prev) => ({ ...prev, [id]: freshGuides[id] ?? "" }));
        setGuides((prev) => ({ ...prev, [id]: freshGuides[id] ?? "" }));
        setDirty((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setGuideSuccess(`Гайд для ${SUPPORTED_EXCHANGES[id as ExchangeId]?.name ?? id} сброшен к умолчанию`);
      }
    } catch (err: any) {
      setGuideError(err.message || "Не удалось сбросить гайд");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mt-6 max-w-3xl">
      {guideError && (
        <div className="mb-4 rounded-lg bg-loss/10 border border-loss/20 text-loss text-sm p-3">
          {guideError}
        </div>
      )}
      {guideSuccess && (
        <div className="mb-4 rounded-lg bg-profit/10 border border-profit/20 text-profit text-sm p-3">
          {guideSuccess}
        </div>
      )}

      <div className="card divide-y divide-border overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-faint">Загрузка…</div>
        ) : (
          rows.map((r) => {
            const isOpen = expanded.has(r.id);
            const currentGuide = edits[r.id] ?? guides[r.id] ?? "";
            const isDirty = dirty.has(r.id);
            const meta = SUPPORTED_EXCHANGES[r.id as ExchangeId];

            return (
              <div key={r.id}>
                {/* Header row — toggle switches + expand */}
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleExpand(r.id)}
                    className="flex items-center gap-3 text-left min-w-0"
                  >
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-muted font-semibold uppercase text-xs shrink-0">
                      {r.id.slice(0, 3)}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2">
                        {r.name}
                        {isDirty && (
                          <span className="text-[10px] uppercase tracking-wider text-warn font-medium">
                            Изменено
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-faint">
                        {r.id}
                        {r.needsPassphrase ? " · passphrase" : ""}
                      </div>
                    </div>
                  </button>

                  {/* Inline toggle switches */}
                  <div className="flex items-center gap-4 shrink-0">
                    <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        on={r.enabled}
                        disabled={busy === r.id}
                        onClick={() => toggle(r.id, { enabled: !r.enabled })}
                      />
                      Вкл
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        on={r.demoEnabled}
                        disabled={busy === r.id}
                        onClick={() => toggle(r.id, { demoEnabled: !r.demoEnabled })}
                      />
                      Демо
                    </label>
                  </div>

                  {/* External link + expand */}
                  <div className="flex items-center gap-1 shrink-0">
                    {meta?.docsUrl && (
                      <a
                        href={meta.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 rounded text-faint hover:text-accent hover:bg-surface-2"
                        title="Открыть страницу управления API ключами"
                      >
                        <ExternalLink size={16} />
                      </a>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleExpand(r.id)}
                    className="p-1.5 rounded text-faint hover:text-fg hover:bg-surface-2 shrink-0"
                  >
                    {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </button>
                </div>

                {/* Expanded guide editor */}
                {isOpen && (
                  <div className="border-t border-border px-4 py-3 space-y-3 ml-0">
                    <div className="text-xs text-muted font-medium">
                      Гайд подключения — показывается пользователю при выборе этой биржи
                    </div>
                    <textarea
                      className="input-base w-full font-mono text-xs min-h-[180px] resize-y"
                      value={currentGuide}
                      onChange={(e) => handleEditGuide(r.id, e.target.value)}
                      placeholder="Текст подсказки..."
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSaveGuide(r.id)}
                        disabled={saving === r.id || !isDirty}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Save size={14} />
                        {saving === r.id ? "Сохранение..." : "Сохранить гайд"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResetGuide(r.id)}
                        disabled={saving === r.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-muted border border-border hover:bg-surface-2 transition disabled:opacity-50"
                      >
                        <RotateCcw size={14} />
                        Сбросить
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <p className="mt-2 text-xs text-faint">
        «Вкл» — биржа доступна для добавления аккаунтов. «Демо» — доступен ли тестовый/demo-счёт. Для
        бирж без sandbox в ccxt подключение демо может не сработать.
      </p>
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
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 ${
        on ? "bg-accent" : "bg-surface-2 border border-border"
      }`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white transition ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}