"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, ChevronDown, ChevronUp } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";
import { levelTypeLabel, signalLabel, directionLabel } from "@/lib/recommendations/labels";
import { fmtDate } from "@/lib/format";

type Bias = "breakout" | "false_breakout";
type Direction = "long" | "short";

type Quality = {
  crossings: number;
  falseBreakouts: number;
  deepestFalseBreakoutAtr: number;
  contamination: number;
  runwayAtr: number | null;
  closeDistanceAtr: number;
};

type LevelSetup = {
  id: string;
  symbol: string;
  levelPrice: number;
  levelType: string;
  strength: number;
  distanceAtr: number;
  bias: Bias;
  direction: Direction;
  signals: { for: string[]; against: string[] };
  quality: Quality;
  atr: number;
  currentPrice: number;
  /** БСУ — бар, сформировавший уровень. */
  bsuAt: string;
  /** Последний ЗАКРЫТЫЙ день, по который считался анализ. */
  candlesTo: string;
};

// Короткая сводка «почему этот уровень чистый» — те самые условия, по которым
// сетап прошёл отбор (см. src/lib/recommendations/quality.ts).
function QualityChips({ q }: { q: Quality | null | undefined }) {
  // Строки, записанные до появления метрик качества, приходят без quality —
  // карточка должна просто обойтись без чипов, а не падать.
  if (!q) return null;
  const runway = q.runwayAtr === null || !Number.isFinite(q.runwayAtr) ? "∞" : q.runwayAtr.toFixed(1);
  const chips = [
    `закрытие в ${q.closeDistanceAtr.toFixed(2)}×ATR от уровня`,
    q.crossings === 0 ? "без запилов" : `запилов: ${q.crossings}`,
    q.falseBreakouts === 0
      ? "ложных пробоев не было"
      : `${q.falseBreakouts} ЛП, глубина ${q.deepestFalseBreakoutAtr.toFixed(2)}×ATR`,
    `за уровнем чисто (${Math.round(q.contamination * 100)}%)`,
    `запас хода ${runway}×ATR`,
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span key={c} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
          {c}
        </span>
      ))}
    </div>
  );
}

type Candle = { t: number; o: number; h: number; l: number; c: number };

type FeatureValue = { enabled: boolean };

const BIAS_FILTERS: { key: Bias | "all"; label: string }[] = [
  { key: "all", label: "Все сетапы" },
  { key: "breakout", label: "Пробой" },
  { key: "false_breakout", label: "Ложный пробой" },
];

const DIRECTION_FILTERS: { key: Direction | "all"; label: string }[] = [
  { key: "all", label: "Оба направления" },
  { key: "long", label: "Лонг" },
  { key: "short", label: "Шорт" },
];

const BIAS_LABELS: Record<Bias, string> = {
  breakout: "Пробой",
  false_breakout: "Ложный пробой",
};

// Цвет бейджа — по направлению сделки (лонг зелёный / шорт красный), а не по
// типу сетапа: направление — то, что трейдеру нужно считать с карточки первым.
function BiasBadge({ bias, direction }: { bias: Bias; direction: Direction }) {
  const long = direction === "long";
  const Icon = long ? TrendingUp : TrendingDown;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        long ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss",
      )}
    >
      <Icon size={12} />
      {BIAS_LABELS[bias]} · {directionLabel(direction)}
    </span>
  );
}

const DAY_MS = 86_400_000;

/**
 * Дневной график вокруг уровня.
 *
 * Отдельно помечены два бара, без которых картинка вводит в заблуждение:
 *  - БСУ (бар, сформировавший уровень) — стрелкой со стороны уровня;
 *  - сегодняшний НЕЗАКРЫТЫЙ бар — он в анализе не участвовал (считали по
 *    последнему закрытому дню), поэтому отделён вертикальной чертой и
 *    приглушён: иначе кажется, что сетап уже противоречит графику.
 *
 * Высота задана явно (h-72 вместо прежних h-36): при низкой картинке свечи
 * плющились и паранормальный бар — тот самый, что образует сильный уровень, —
 * не читался на фоне остальных.
 */
function LevelSnapshot({
  candles,
  levelPrice,
  bsuAt,
  analysedTo,
  levelAbovePrice,
}: {
  candles: Candle[];
  levelPrice: number;
  bsuAt: number;
  analysedTo: number;
  levelAbovePrice: boolean;
}) {
  if (candles.length === 0) return null;
  const width = 640;
  const height = 300;
  const padY = 22;
  const lo = Math.min(...candles.map((c) => c.l), levelPrice);
  const hi = Math.max(...candles.map((c) => c.h), levelPrice);
  const span = hi - lo || 1;
  const barW = width / candles.length;
  const y = (price: number) => padY + (1 - (price - lo) / span) * (height - 2 * padY);
  const levelY = y(levelPrice);

  // Бар считаем «тем самым», если он попадает в те же сутки, что и БСУ.
  const bsuIndex = candles.findIndex((c) => Math.abs(c.t - bsuAt) < DAY_MS / 2);
  // Уровень выше цены — стрелка над баром, иначе под ним. Сторону берём из
  // самого сетапа, а не из последнего бара графика: там сегодняшний живой
  // бар, и стрелка прыгала бы вслед за внутридневным движением.
  const arrowAbove = levelAbovePrice;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-72"
      preserveAspectRatio="none"
      role="img"
      aria-label="Дневной график вокруг уровня"
    >
      <line x1={0} x2={width} y1={levelY} y2={levelY} stroke="var(--color-accent)" strokeWidth={1} strokeDasharray="4 3" />

      {candles.map((c, i) => {
        const x = i * barW + barW / 2;
        const up = c.c >= c.o;
        const color = up ? "var(--color-profit)" : "var(--color-loss)";
        // Бары новее последнего проанализированного — сегодняшний живой бар.
        const unclosed = c.t > analysedTo;
        return (
          <g key={c.t} opacity={unclosed ? 0.45 : 1}>
            <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1} />
            <line
              x1={x}
              x2={x}
              y1={y(c.o)}
              y2={y(c.c)}
              stroke={color}
              strokeWidth={Math.max(2, barW * 0.6)}
              strokeDasharray={unclosed ? "3 2" : undefined}
            />
          </g>
        );
      })}

      {/* Граница между проанализированной историей и текущим днём */}
      {(() => {
        const firstUnclosed = candles.findIndex((c) => c.t > analysedTo);
        if (firstUnclosed <= 0) return null;
        const x = firstUnclosed * barW;
        return <line x1={x} x2={x} y1={0} y2={height} stroke="var(--color-border)" strokeWidth={1} strokeDasharray="2 3" />;
      })()}

      {/* Стрелка на БСУ */}
      {bsuIndex >= 0 &&
        (() => {
          const x = bsuIndex * barW + barW / 2;
          const tip = arrowAbove ? y(candles[bsuIndex].h) - 4 : y(candles[bsuIndex].l) + 4;
          const tail = arrowAbove ? tip - 14 : tip + 14;
          const head = arrowAbove
            ? `${x},${tip} ${x - 4},${tip - 6} ${x + 4},${tip - 6}`
            : `${x},${tip} ${x - 4},${tip + 6} ${x + 4},${tip + 6}`;
          return (
            <g>
              <line x1={x} x2={x} y1={tail} y2={tip} stroke="var(--color-accent)" strokeWidth={1.5} />
              <polygon points={head} fill="var(--color-accent)" />
              <text
                x={Math.min(Math.max(x, 16), width - 16)}
                y={arrowAbove ? tail - 4 : tail + 11}
                textAnchor="middle"
                fontSize={11}
                fill="var(--color-accent)"
              >
                БСУ
              </text>
            </g>
          );
        })()}
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
          const all: Candle[] = j.candles ?? [];
          // Окно графика растягиваем так, чтобы БСУ был виден: если уровень
          // сформирован давно, без этого стрелке некуда встать.
          const bsuIdx = all.findIndex((c) => Math.abs(c.t - Date.parse(setup.bsuAt)) < DAY_MS / 2);
          const need = bsuIdx >= 0 ? all.length - bsuIdx + 5 : 0;
          setCandles(all.slice(-Math.min(Math.max(60, need), 160)));
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
            <BiasBadge bias={setup.bias} direction={setup.direction} />
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
          <div className="text-xs text-faint">
            {setup.levelPrice >= setup.currentPrice ? "Уровень выше цены" : "Уровень ниже цены"} ·{" "}
            {BIAS_LABELS[setup.bias].toLowerCase()} отсюда отрабатывается в{" "}
            <span className={setup.direction === "long" ? "text-profit" : "text-loss"}>
              {directionLabel(setup.direction)}
            </span>
          </div>
          <QualityChips q={setup.quality} />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-accent">БСУ — {fmtDate(setup.bsuAt)}</span>
            <span className="text-faint">
              анализ по закрытию {fmtDate(setup.candlesTo)}; сегодняшний бар ещё формируется и показан
              приглушённым
            </span>
          </div>

          {loadingCandles && <div className="text-sm text-muted">Загрузка…</div>}
          {candles && candles.length > 0 && (
            <LevelSnapshot
              candles={candles}
              levelPrice={setup.levelPrice}
              bsuAt={Date.parse(setup.bsuAt)}
              analysedTo={Date.parse(setup.candlesTo)}
              levelAbovePrice={setup.levelPrice >= setup.currentPrice}
            />
          )}

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
  const [directionFilter, setDirectionFilter] = useState<Direction | "all">("all");
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

  const filtered = setups.filter(
    (s) => (filter === "all" || s.bias === filter) && (directionFilter === "all" || s.direction === directionFilter),
  );

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Рекомендации</h1>
        <p className="text-sm text-muted mt-1">
          Инструменты, готовые к торговле сегодня: из всех бессрочных USDT-контрактов Binance — крипта плюс
          золото, серебро и акции — остаются только те, где
          вчерашний день закрылся вплотную к уровню, слева нет распила и глубоких ложных пробоев, а за
          уровнем пусто. На инструмент — один, самый сильный сетап. Не сигнал «покупай/продавай» — только
          подготовка к торговому дню, решение за вами.
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

      <div className="flex gap-2 flex-wrap">
        {DIRECTION_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setDirectionFilter(f.key)}
            className={clsx(
              "px-3 py-1.5 rounded-lg text-sm transition",
              directionFilter === f.key ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-2",
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
