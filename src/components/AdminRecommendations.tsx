"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import clsx from "clsx";

type Status = {
  total: number;
  symbolsCovered: number;
  byBias: Record<string, number>;
  lastComputedAt: string | null;
  lastCandlesTo: string | null;
};

type FeatureValue = { enabled: boolean; maxDistanceAtr: number };
type FeatureRow = { key: string; fieldHelp: Record<string, string>; value: FeatureValue };

function Switch({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 shrink-0",
        on ? "bg-accent" : "bg-surface-2 border border-border",
      )}
    >
      <span className={clsx("inline-block h-4 w-4 rounded-full bg-white transition", on ? "translate-x-6" : "translate-x-1")} />
    </button>
  );
}

function agoLabel(iso: string | null): string {
  if (!iso) return "ещё не считалось";
  const ms = Date.now() - Date.parse(iso);
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}с назад`;
  if (sec < 3600) return `${Math.round(sec / 60)}мин назад`;
  if (sec < 86400) return `${Math.round(sec / 3600)}ч назад`;
  return `${Math.round(sec / 86400)}д назад`;
}

export default function AdminRecommendations() {
  const [status, setStatus] = useState<Status | null>(null);
  const [feature, setFeature] = useState<FeatureRow | null>(null);
  const [maxDistanceDraft, setMaxDistanceDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/admin/recommendations", { cache: "no-store" });
    if (res.ok) setStatus(await res.json());
  }, []);

  const loadFeature = useCallback(async () => {
    const res = await fetch("/api/admin/features", { cache: "no-store" });
    if (res.ok) {
      const row = ((await res.json()).features ?? []).find((r: FeatureRow) => r.key === "tradeRecommendations");
      if (row) {
        setFeature(row);
        setMaxDistanceDraft(String(row.value.maxDistanceAtr));
      }
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadFeature();
  }, [loadStatus, loadFeature]);

  async function rescan() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/recommendations", { method: "POST" });
      if (res.ok) {
        setStatus(await res.json());
      } else {
        setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled() {
    if (!feature) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "tradeRecommendations", enabled: !feature.value.enabled }),
      });
      if (res.ok) {
        const row = ((await res.json()).features ?? []).find((r: FeatureRow) => r.key === "tradeRecommendations");
        if (row) setFeature(row);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveMaxDistance() {
    const n = Number(maxDistanceDraft);
    if (!Number.isFinite(n) || n <= 0) return;
    setSavingConfig(true);
    try {
      const res = await fetch("/api/admin/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "tradeRecommendations", config: { maxDistanceAtr: n } }),
      });
      if (res.ok) {
        const row = ((await res.json()).features ?? []).find((r: FeatureRow) => r.key === "tradeRecommendations");
        if (row) setFeature(row);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    } finally {
      setSavingConfig(false);
    }
  }

  const breakout = status?.byBias.breakout ?? 0;
  const falseBreakout = status?.byBias.false_breakout ?? 0;
  const neutral = status?.byBias.neutral ?? 0;

  return (
    <div className="mt-6 space-y-6 max-w-2xl">
      {/* Статус + ручной пересчёт */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Текущая картина дня</div>
            <p className="text-xs text-muted mt-1">
              Последний пересчёт: {agoLabel(status?.lastComputedAt ?? null)}
              {status?.lastCandlesTo && (
                <> · свечи по {new Date(status.lastCandlesTo).toLocaleDateString("ru-RU")}</>
              )}
            </p>
          </div>
          <button
            onClick={rescan}
            disabled={busy}
            className="input-base px-3 py-1.5 text-sm hover:border-border-strong disabled:opacity-50 flex items-center gap-2 shrink-0"
          >
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
            Пересчитать сейчас
          </button>
        </div>

        {error && <div className="text-xs text-loss">Ошибка: {error}</div>}

        <div className="flex flex-wrap gap-4 text-sm border-t border-border pt-3">
          <span className="text-muted">
            Уровней: <span className="text-fg font-medium">{status?.total ?? "—"}</span>
          </span>
          <span className="text-muted">
            Пар: <span className="text-fg font-medium">{status?.symbolsCovered ?? "—"}</span>
          </span>
          <span className="flex items-center gap-1 text-profit">
            <TrendingUp size={14} /> Пробой: {breakout}
          </span>
          <span className="flex items-center gap-1 text-loss">
            <TrendingDown size={14} /> Ложный пробой: {falseBreakout}
          </span>
          <span className="flex items-center gap-1 text-muted">
            <Minus size={14} /> Нейтрально: {neutral}
          </span>
        </div>

        <p className="text-[11px] text-faint">
          Пересчёт использует уже собранные дневные свечи (их раз в сутки сканирует collector по
          всем USDT-M бессрочным фьючерсам Binance) — сюда не входит загрузка новых свечей, только
          повторный анализ уровней/сигналов по тому, что уже есть в базе.
        </p>
      </div>

      {/* Настройки фичи */}
      {feature && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Раздел «Рекомендации» пользователям</div>
              <p className="text-xs text-muted mt-1">
                {feature.value.enabled
                  ? "Включено — пункт меню и данные видны всем пользователям."
                  : "Выключено — пункт меню и API скрыты у всех пользователей."}
              </p>
            </div>
            <Switch on={feature.value.enabled} disabled={busy} onClick={toggleEnabled} />
          </div>

          <div className="border-t border-border pt-3 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-medium">maxDistanceAtr</div>
              <p className="text-[11px] text-faint mt-0.5 leading-relaxed max-w-md">
                {feature.fieldHelp.maxDistanceAtr}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="number"
                step="0.1"
                min="0.1"
                className="w-24 input-base px-2 py-1 text-sm"
                value={maxDistanceDraft}
                onChange={(e) => setMaxDistanceDraft(e.target.value)}
              />
              <button
                onClick={saveMaxDistance}
                disabled={savingConfig}
                className="input-base px-3 py-1.5 text-sm hover:border-border-strong disabled:opacity-50"
              >
                Сохранить
              </button>
            </div>
          </div>
          {saved && <span className="text-xs text-profit">Сохранено — вступит в силу со следующего пересчёта.</span>}
        </div>
      )}
    </div>
  );
}
