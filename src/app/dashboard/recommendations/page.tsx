"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";
import { levelTypeLabel, signalLabel } from "@/lib/recommendations/labels";

type Bias = "breakout" | "false_breakout" | "neutral";

type LevelSetup = {
  id: string;
  symbol: string;
  levelPrice: number;
  levelType: string;
  strength: number;
  distanceAtr: number;
  bias: Bias;
  signals: { for: string[]; against: string[] };
  atr: number;
  currentPrice: number;
};

type Candle = { t: number; o: number; h: number; l: number; c: number };

type FeatureValue = { enabled: boolean };

const BIAS_FILTERS: { key: Bias | "all"; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "breakout", label: "Пробой" },
  { key: "false_breakout", label: "Ложный пробой" },
  { key: "neutral", label: "Нейтрально" },
];

function BiasBadge({ bias }: { bias: Bias }) {
  if (bias === "breakout") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-profit/15 text-profit px-2 py-0.5 text-xs font-medium">
        <TrendingUp size={12} /> Пробой
      </span>
    );
  }
  if (bias === "false_breakout") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-loss/15 text-loss px-2 py-0.5 text-xs font-medium">
        <TrendingDown size={12} /> Ложный пробой
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 text-muted px-2 py-0.5 text-xs font-medium">
      <Minus size={12} /> Нейтрально
    </span>
  );
}

function LevelSnapshot({ candles, levelPrice }: { candles: Candle[]; levelPrice: number }) {
  if (candles.length === 0) return null;
  const width = 640;
  const height = 140;
  const padY = 10;
  const lo = Math.min(...candles.map((c) => c.l), levelPrice);
  const hi = Math.max(...candles.map((c) => c.h), levelPrice);
  const span = hi - lo || 1;
  const barW = width / candles.length;
  const y = (price: number) => padY + (1 - (price - lo) / span) * (height - 2 * padY);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-36" preserveAspectRatio="none">
      <line
        x1={0}
        x2={width}
        y1={y(levelPrice)}
        y2={y(levelPrice)}
        stroke="var(--color-accent)"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      {candles.map((c, i) => {
        const x = i * barW + barW / 2;
        const up = c.c >= c.o;
        return (
          <g key={c.t}>
            <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={up ? "var(--color-profit)" : "var(--color-loss)"} strokeWidth={1} />
            <line
              x1={x}
              x2={x}
              y1={y(c.o)}
              y2={y(c.c)}
              stroke={up ? "var(--color-profit)" : "var(--color-loss)"}
              strokeWidth={Math.max(2, barW * 0.6)}
            />
          </g>
        );
      })}
    </svg>
  );
}

function SetupCard({ setup }: { setup: LevelSetup }) {
  const [open, setOpen] = useState(false);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [loadingCandles, setLoadingCandles] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !candles && !loadingCandles) {
      setLoadingCandles(true);
      try {
        const res = await fetch(`/api/recommendations/${setup.symbol}/candles`);
        if (res.ok) {
          const j = await res.json();
          setCandles((j.candles ?? []).slice(-60));
        }
      } finally {
        setLoadingCandles(false);
      }
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface-1 overflow-hidden">
      <button onClick={toggle} className="w-full flex items-center gap-3 p-4 text-left hover:bg-surface-2 transition">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{setup.symbol}</span>
            <BiasBadge bias={setup.bias} />
            <span className="text-xs text-muted">{levelTypeLabel(setup.levelType)}</span>
          </div>
          <div className="text-sm text-muted mt-1">
            Уровень {setup.levelPrice} · цена {setup.currentPrice} · {setup.distanceAtr.toFixed(2)}×ATR ·
            сила {setup.strength}
          </div>
        </div>
        {open ? <ChevronUp size={16} className="shrink-0" /> : <ChevronDown size={16} className="shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {loadingCandles && <div className="text-sm text-muted">Загрузка…</div>}
          {candles && candles.length > 0 && <LevelSnapshot candles={candles} levelPrice={setup.levelPrice} />}

          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="font-medium text-profit mb-1">За пробой</div>
              {setup.signals.for.length === 0 ? (
                <div className="text-faint">—</div>
              ) : (
                <ul className="space-y-0.5">
                  {setup.signals.for.map((s) => (
                    <li key={s} className="text-muted">
                      + {signalLabel(s)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="font-medium text-loss mb-1">За ложный пробой</div>
              {setup.signals.against.length === 0 ? (
                <div className="text-faint">—</div>
              ) : (
                <ul className="space-y-0.5">
                  {setup.signals.against.map((s) => (
                    <li key={s} className="text-muted">
                      − {signalLabel(s)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RecommendationsPage() {
  useI18n();
  const [feature, setFeature] = useState<FeatureValue | null>(null);
  const [setups, setSetups] = useState<LevelSetup[]>([]);
  const [filter, setFilter] = useState<Bias | "all">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [featureRes, setupsRes] = await Promise.all([
        fetch("/api/features?key=tradeRecommendations"),
        fetch("/api/recommendations"),
      ]);
      if (featureRes.ok) setFeature((await featureRes.json()).value);
      if (setupsRes.ok) setSetups((await setupsRes.json()).setups ?? []);
      setLoading(false);
    }
    load();
  }, []);

  if (!loading && feature && !feature.enabled) {
    return <div className="p-6 text-muted">Функция «Рекомендации» отключена.</div>;
  }

  const filtered = filter === "all" ? setups : setups.filter((s) => s.bias === filter);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Рекомендации</h1>
        <p className="text-sm text-muted mt-1">
          Дневные уровни рядом с текущей ценой по всем USDT-M фьючерсам Binance, с факторами «за пробой» /
          «за ложный пробой». Не сигнал «покупай/продавай» — только подготовка к торговому дню, решение за вами.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {BIAS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={clsx(
              "px-3 py-1.5 rounded-lg text-sm transition",
              filter === f.key ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-2",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-muted text-sm">Загрузка…</div>
      ) : filtered.length === 0 ? (
        <div className="text-muted text-sm">Пока нет уровней рядом с ценой — данные обновляются раз в сутки.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <SetupCard key={s.id} setup={s} />
          ))}
        </div>
      )}
    </div>
  );
}
