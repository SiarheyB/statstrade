"use client";

import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, ChevronDown, ChevronUp } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";
import { levelTypeLabel, signalLabel, directionLabel } from "@/lib/recommendations/labels";
import { fmtDate, fmtPrice, numLocale } from "@/lib/format";

// Компактная запись $-объёма (1 234 567 → "$1.23M") — своя, а не fmtNumSmart:
// нужна короткая форма, не тысячи с разделителями. Значение уже в долларах
// (объём в базовом активе × цена закрытия, см. recompute.ts).
function fmtVolume(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return "$" + new Intl.NumberFormat(numLocale(), { notation: "compact", maximumFractionDigits: 2 }).format(v);
}

// Светофор ликвидности по дневному объёму: <10M — тонко (красный),
// 10–20M — средне (жёлтый), >20M — комфортно для входа (зелёный).
function volumeClass(v: number): string {
  if (!Number.isFinite(v)) return "text-faint";
  if (v < 10_000_000) return "text-loss";
  if (v <= 20_000_000) return "text-warn";
  return "text-profit";
}

type Bias = "breakout" | "false_breakout";
type Direction = "long" | "short";

// Метрики качества добавлялись в разное время, поэтому у старых записей часть
// полей отсутствует — тип это отражает, чтобы карточка не падала на undefined.
type Quality = {
  crossings?: number | null;
  falseBreakouts?: number | null;
  deepestFalseBreakoutAtr?: number | null;
  lastBarPierceAtr?: number | null;
  contamination?: number | null;
  runwayAtr?: number | null;
  closeDistanceAtr?: number | null;
  approachGapAtr?: number | null;
};

// Число или null — «поля нет / оно битое», чип с ним просто не рисуем.
function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

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
  /** $-объём (объём в базовом активе × цена закрытия) последнего закрытого дневного бара. */
  lastVolume: number | null;
};

// Короткая сводка «почему этот уровень чистый» — те самые условия, по которым
// сетап прошёл отбор (см. src/lib/recommendations/quality.ts). Каждый чип —
// цифра в единицах ATR, которая сама по себе непонятна без контекста, поэтому
// рядом с числом в скобках дублируем его в реальной цене, а по наведению
// показываем всплывающую подсказку с объяснением метрики и порога отбора.
function QualityChips({ q, atr, bias }: { q: Quality | null | undefined; atr: number; bias: Bias }) {
  // Строки, записанные до появления метрик качества, приходят без quality —
  // карточка должна просто обойтись без чипов, а не падать.
  if (!q) return null;
  const runwayAtr = num(q.runwayAtr);
  const runwayInfinite = runwayAtr === null;
  const runway = runwayInfinite ? "∞" : runwayAtr.toFixed(1);
  const closeDistanceAtr = num(q.closeDistanceAtr);
  const approachGapAtr = num(q.approachGapAtr);
  const crossings = num(q.crossings);
  const falseBreakouts = num(q.falseBreakouts);
  const deepestAtr = num(q.deepestFalseBreakoutAtr);
  // Прокол вчерашнего бара в falseBreakouts не входит (те считаются по истории
  // без последнего бара), поэтому без отдельной ветки чип написал бы «ложных
  // пробоев не было» ровно в тот день, когда прокол и случился.
  const lastBarPierceAtr = num(q.lastBarPierceAtr);
  const contamination = num(q.contamination);

  // Требование к подходу у пробоя и ЛП противоположное: пробою нужно
  // закрытие ВПЛОТНУЮ к уровню, а ЛП — наоборот, чтобы вчера цена остановилась
  // ДАЛЕКО (на целый ATR), и весь путь до уровня + прокол + возврат сделал
  // сегодняшний бар. Поэтому первый чип и его подсказка зависят от bias.
  const approachChip: { text: string; tooltip: string } | null =
    bias === "breakout"
      ? closeDistanceAtr === null
        ? null
        : {
            text: `закрытие в ${closeDistanceAtr.toFixed(2)}×ATR от уровня (${fmtPrice(closeDistanceAtr * atr)})`,
            tooltip:
              `ATR — средний дневной диапазон цены инструмента (здесь ${fmtPrice(atr)}), его «естественный шаг». ` +
              `Последний закрытый день закрылся в ${closeDistanceAtr.toFixed(2)} такого шага от уровня — то есть ` +
              `примерно на ${fmtPrice(closeDistanceAtr * atr)} по цене. Чем ближе к нулю, тем плотнее подошли к уровню. ` +
              `В подборку попадают только уровни с закрытием не дальше 0.25×ATR.`,
          }
      : approachGapAtr === null
        ? null
        : {
            text: `вчера не дошли ${approachGapAtr.toFixed(2)}×ATR до уровня (${fmtPrice(approachGapAtr * atr)})`,
            tooltip:
              `ATR — средний дневной диапазон цены инструмента (здесь ${fmtPrice(atr)}), его «естественный шаг». ` +
              `Для ложного пробоя нужно, чтобы вчера бар остановился ДАЛЕКО от уровня — тогда сегодняшнему бару ` +
              `придётся пройти весь этот путь, проколоть уровень и вернуться обратно за один день. Сейчас разрыв — ` +
              `${approachGapAtr.toFixed(2)}×ATR (≈${fmtPrice(approachGapAtr * atr)}). Чем больше, тем чище разгон. ` +
              `В подборку попадают только уровни с разрывом не меньше 1×ATR.`,
          };

  const chips: ({ text: string; tooltip: string } | null)[] = [
    approachChip,
    crossings === null
      ? null
      : {
          text: crossings === 0 ? "без запилов" : `запилов: ${crossings}`,
          tooltip:
            "Запил — сколько раз за последние ~60 дней закрытие цены перекладывалось то выше, то ниже уровня. " +
            "Много перекладок значит рынок не уважает уровень, а пилит его туда-сюда. Допускается не больше одной.",
        },
    falseBreakouts === null
      ? null
      : {
          text:
            lastBarPierceAtr !== null && lastBarPierceAtr > 0
              ? `прокол вчера ${lastBarPierceAtr.toFixed(2)}×ATR`
              : falseBreakouts === 0
                ? "ложных пробоев не было"
                : deepestAtr === null
                  ? `${falseBreakouts} ЛП`
                  : `${falseBreakouts} ЛП, глубина ${deepestAtr.toFixed(2)}×ATR`,
          tooltip:
            "Ложный пробой (ЛП) — бар, чей хай/лоу проколол уровень, но закрытие вернулось обратно. Глубина — на " +
            "сколько ATR цена успела уйти за уровень при проколе. Глубокий прокол значит, что стопы за уровнем уже " +
            "сняты, и энергии для настоящего пробоя может не хватить. Прокол на вчерашнем баре показывается отдельно: " +
            "после него ещё не было ни одного дня, который бы уровень удержал.",
        },
    contamination === null
      ? null
      : {
          text: `за уровнем чисто (${Math.round(contamination * 100)}%)`,
          tooltip:
            `Заражённость — доля дней за последние ~120, когда цена уже торговалась в зоне сразу за уровнем (ширина ` +
            `зоны — 1×ATR). Сейчас ${Math.round(contamination * 100)}% — там уже «топтались»; чем меньше, тем чище ` +
            `пробойная плоскость впереди. Порог отбора — не больше 10%.`,
        },
    {
      text: `запас хода ${runway}×ATR`,
      tooltip: runwayInfinite
        ? "Запас хода — расстояние от уровня до ближайшего следующего значимого уровня в направлении движения. " +
          "Впереди значимых уровней не нашлось — запас хода ничем не ограничен."
        : `Запас хода — расстояние от уровня до ближайшего следующего значимого уровня в направлении движения, в ` +
          `шагах ATR. Здесь ${runway}×ATR (≈${fmtPrice(Number(runway) * atr)}) — на столько цена сможет пройти, ` +
          `прежде чем упрётся в следующее препятствие.`,
    },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.filter((c) => c !== null).map((c) => (
        <span key={c.text} className="relative group">
          <span className="cursor-help rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted underline decoration-dotted decoration-faint underline-offset-2">
            {c.text}
          </span>
          <span className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-64 whitespace-normal rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs text-fg shadow-lg group-hover:block">
            {c.tooltip}
          </span>
        </span>
      ))}
    </div>
  );
}

type Candle = { t: number; o: number; h: number; l: number; c: number; v?: number };

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
// Компактная дата для подписей оси X — та же локаль/раскладка, что и fmtDate
// (день.месяц.год), но без года: на оси из 6-8 подписей год был бы лишним
// шумом, а дублирование поперёк всех тиков — избыточно.
function shortDate(t: number): string {
  return fmtDate(t).slice(0, 5);
}

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
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{ index: number; y: number } | null>(null);
  if (candles.length === 0) return null;

  const width = 680;
  const height = 320;
  const padTop = 10;
  const padBottom = 22;
  const padRight = 56;
  const chartW = width - padRight;
  const plotH = height - padTop - padBottom;

  const lo = Math.min(...candles.map((c) => c.l), levelPrice);
  const hi = Math.max(...candles.map((c) => c.h), levelPrice);
  const span = hi - lo || 1;
  const barW = chartW / candles.length;
  const y = (price: number) => padTop + (1 - (price - lo) / span) * plotH;
  const priceAtY = (yPix: number) => lo + (1 - (yPix - padTop) / plotH) * span;
  const levelY = y(levelPrice);

  const hoveredCandle = hover ? candles[hover.index] : null;
  // Без наведения шапка показывает последний закрытый бар — как на обычных
  // терминалах, где OHLC в углу всегда что-то показывает, а не пропадает.
  const lastClosed = [...candles].reverse().find((c) => c.t <= analysedTo) ?? candles[candles.length - 1];
  const headerCandle = hoveredCandle ?? lastClosed;

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * width;
    const svgY = ((e.clientY - rect.top) / rect.height) * height;
    const index = Math.min(Math.max(Math.floor(svgX / barW), 0), candles.length - 1);
    setHover({ index, y: Math.min(Math.max(svgY, padTop), height - padBottom) });
  }

  // Бар считаем «тем самым», если он попадает в те же сутки, что и БСУ.
  const bsuIndex = candles.findIndex((c) => Math.abs(c.t - bsuAt) < DAY_MS / 2);
  // Уровень выше цены — стрелка над баром, иначе под ним. Сторону берём из
  // самого сетапа, а не из последнего бара графика: там сегодняшний живой
  // бар, и стрелка прыгала бы вслед за внутридневным движением.
  const arrowAbove = levelAbovePrice;

  const PRICE_TICKS = 5;
  const priceTicks = Array.from({ length: PRICE_TICKS }, (_, i) => lo + (span * i) / (PRICE_TICKS - 1));

  const DATE_TICKS = Math.min(7, candles.length);
  const dateTickIndices = Array.from(
    new Set(Array.from({ length: DATE_TICKS }, (_, i) => Math.round((i * (candles.length - 1)) / (DATE_TICKS - 1)))),
  );

  return (
    <div className="relative">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
        <span className={headerCandle.c >= headerCandle.o ? "text-profit" : "text-loss"}>
          O {fmtPrice(headerCandle.o)} H {fmtPrice(headerCandle.h)} L {fmtPrice(headerCandle.l)} C{" "}
          {fmtPrice(headerCandle.c)}
        </span>
        <span className="text-faint">{fmtDate(headerCandle.t)}</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-72"
        preserveAspectRatio="none"
        role="img"
        aria-label="Дневной график вокруг уровня"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Сетка и подписи цены справа */}
        {priceTicks.map((p) => (
          <g key={p}>
            <line x1={0} x2={chartW} y1={y(p)} y2={y(p)} stroke="var(--color-border)" strokeWidth={1} opacity={0.4} />
            <text x={chartW + 6} y={y(p) + 3} fontSize={10} fill="var(--color-muted)">
              {fmtPrice(p)}
            </text>
          </g>
        ))}

        {/* Подписи дат снизу */}
        {dateTickIndices.map((i) => (
          <text
            key={i}
            x={i * barW + barW / 2}
            y={height - 6}
            fontSize={10}
            textAnchor="middle"
            fill="var(--color-muted)"
          >
            {shortDate(candles[i].t)}
          </text>
        ))}

        <line x1={0} x2={chartW} y1={levelY} y2={levelY} stroke="var(--color-accent)" strokeWidth={1} strokeDasharray="4 3" />

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
          return (
            <line x1={x} x2={x} y1={padTop} y2={height - padBottom} stroke="var(--color-border)" strokeWidth={1} strokeDasharray="2 3" />
          );
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
                  x={Math.min(Math.max(x, 16), chartW - 16)}
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

        {/* Перекрестье */}
        {hover &&
          (() => {
            const x = hover.index * barW + barW / 2;
            return (
              <g pointerEvents="none">
                <line
                  x1={x}
                  x2={x}
                  y1={padTop}
                  y2={height - padBottom}
                  stroke="var(--color-muted)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <line
                  x1={0}
                  x2={chartW}
                  y1={hover.y}
                  y2={hover.y}
                  stroke="var(--color-muted)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <rect x={chartW} y={hover.y - 8} width={padRight} height={16} fill="var(--color-surface-2)" />
                <text x={chartW + 6} y={hover.y + 3} fontSize={10} fill="var(--color-fg)">
                  {fmtPrice(priceAtY(hover.y))}
                </text>
                <rect
                  x={Math.min(Math.max(x - 22, 0), chartW - 44)}
                  y={height - padBottom}
                  width={44}
                  height={padBottom - 2}
                  fill="var(--color-surface-2)"
                />
                <text
                  x={Math.min(Math.max(x, 22), chartW - 22)}
                  y={height - 6}
                  fontSize={10}
                  textAnchor="middle"
                  fill="var(--color-fg)"
                >
                  {shortDate(candles[hover.index].t)}
                </text>
              </g>
            );
          })()}
      </svg>
    </div>
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
            {setup.lastVolume != null && (
              <>
                {" · "}
                <span className={volumeClass(setup.lastVolume)}>объём {fmtVolume(setup.lastVolume)}</span>
              </>
            )}
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
          <QualityChips q={setup.quality} atr={setup.atr} bias={setup.bias} />

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

export default function RecommendationsView() {
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
