"use client";

import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, ChevronDown, ChevronUp } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";
import { levelTypeLabel, signalLabel, directionLabel } from "@/lib/recommendations/labels";
import { falseBreakoutBudget, returnMoveBudget, todayProgress, type MoveFeasibility } from "@/lib/recommendations/atrBudget";
import { fmtDate, fmtPrice, fmtTime, numLocale } from "@/lib/format";

// Компактная запись $-объёма (1 234 567 → "$1.23M") — своя, а не fmtNumSmart:
// нужна короткая форма, не тысячи с разделителями. Значение уже в долларах
// (объём в базовом активе × цена закрытия, см. recompute.ts).
function fmtVolume(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return "$" + new Intl.NumberFormat(numLocale(), { notation: "compact", maximumFractionDigits: 2 }).format(v);
}

// Величины «в цене» (ATR, размах бара) — короткий формат: fmtPrice для
// дорогих инструментов даёт пять знаков после запятой (37.86760), и в тексте
// это читается как шум. Для копеечной крипты знаки, наоборот, нужны — там
// остаётся fmtPrice.
function fmtAtrPrice(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return v >= 1 ? v.toLocaleString(numLocale(), { maximumFractionDigits: 2 }) : fmtPrice(v);
}

// Светофор ликвидности по дневному объёму: <10M — тонко (красный),
// 10–20M — средне (жёлтый), >20M — комфортно для входа (зелёный).
function volumeClass(v: number): string {
  if (!Number.isFinite(v)) return "text-faint";
  if (v < 10_000_000) return "text-loss";
  if (v <= 20_000_000) return "text-warn";
  return "text-profit";
}

type Bias = "breakout" | "false_breakout" | "false_breakout_2b";
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
  /** Только у ЛП2Б: обратный путь за уровень, в ATR. */
  returnMoveAtr?: number | null;
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

/**
 * Подсказка при наведении для цифр в свёрнутой шапке карточки. Шапка — это
 * кнопка раскрытия, поэтому внутри только неинтерактивные span: подсказка
 * живёт на чистом CSS (group-hover), клик по ней всё так же раскрывает
 * карточку и ничего не перехватывает.
 */
function Hint({ text, children, className }: { text: string; children: React.ReactNode; className?: string }) {
  return (
    <span className="group/hint inline-block">
      <span className={clsx("cursor-help underline decoration-dotted decoration-faint underline-offset-2", className)}>
        {children}
      </span>
      {/* Растягивается по СТРОКЕ карточки (ближайший relative-предок), а не по
          самому слову: привязка к слову уводила подсказку за правый край
          экрана — на мобильной ширине так вылезала половина из них. */}
      <span className="pointer-events-none absolute left-0 right-0 top-full z-40 mt-1 hidden max-w-md whitespace-normal rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs font-normal text-fg shadow-lg group-hover/hint:block">
        {text}
      </span>
    </span>
  );
}

type Candle = { t: number; o: number; h: number; l: number; c: number; v?: number };

type FeatureValue = { enabled: boolean };

const BIAS_FILTERS: { key: Bias | "all"; label: string }[] = [
  { key: "all", label: "Все сетапы" },
  { key: "breakout", label: "Пробой" },
  { key: "false_breakout", label: "Ложный пробой" },
  { key: "false_breakout_2b", label: "ЛП2Б" },
];

const DIRECTION_FILTERS: { key: Direction | "all"; label: string }[] = [
  { key: "all", label: "Оба направления" },
  { key: "long", label: "Лонг" },
  { key: "short", label: "Шорт" },
];

// Число сетапов под фильтром — приглушённое, чтобы не спорить с подписью
// кнопки. Табличные цифры: счётчики не должны прыгать по ширине при смене
// фильтра.
function FilterCount({ value, active }: { value: number; active: boolean }) {
  return <span className={clsx("tabular-nums", active ? "text-accent/70" : "text-faint")}>{value}</span>;
}

const BIAS_LABELS: Record<Bias, string> = {
  breakout: "Пробой",
  false_breakout: "Ложный пробой",
  false_breakout_2b: "ЛП2Б",
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

// Цвет и вердикт по требуемому дневному ходу: до 1 ATR — рядовой день,
// до 2 — редкий, дальше — почти не встречается (статистика из конспекта,
// см. DAY_MOVE_ODDS).
const FEASIBILITY: Record<MoveFeasibility, { text: string; bar: string; note: string }> = {
  routine: { text: "text-profit", bar: "bg-profit", note: "обычный дневной ход" },
  stretch: { text: "text-warn", bar: "bg-warn", note: "ход больше обычного" },
  unlikely: { text: "text-loss", bar: "bg-loss", note: "ход, который бывает редко" },
};

// Линейка дневного хода: 0..3 ATR с засечками на каждом ATR. Заполнение —
// сколько нужно пройти сегодня; отдельной меткой показан ход, уже сделанный
// текущим баром, чтобы «нужно» и «уже прошли» читались на одной шкале.
function AtrRuler({ needAtr, doneAtr, tone }: { needAtr: number; doneAtr?: number; tone: MoveFeasibility }) {
  const MAX = 3;
  const pct = (v: number) => Math.min(100, Math.max(0, (v / MAX) * 100));
  return (
    <div className="mt-2">
      <div className="relative h-2 rounded-full bg-surface-2">
        <div
          className={clsx("absolute inset-y-0 left-0 rounded-full", FEASIBILITY[tone].bar)}
          style={{ width: `${pct(needAtr)}%` }}
        />
        {[1, 2].map((tick) => (
          <div key={tick} className="absolute inset-y-0 w-px bg-bg/70" style={{ left: `${pct(tick)}%` }} />
        ))}
        {doneAtr != null && doneAtr > 0 && (
          <div
            className="absolute -top-1 h-4 w-0.5 rounded bg-fg"
            style={{ left: `${pct(doneAtr)}%` }}
            title={`сегодня уже пройдено ${doneAtr.toFixed(2)}×ATR`}
          />
        )}
      </div>
      {/* Подписи позиционируются по тем же долям, что и засечки: при
          justify-between «1×ATR» и «2×ATR» вставали по краям своих третей и
          не совпадали с делениями, из-за чего шкала читалась неверно. */}
      <div className="relative mt-1 h-3 text-[10px] text-faint">
        {[0, 1, 2, 3].map((tick) => (
          <span
            key={tick}
            // Крайние подписи прижимаем к границам трека, а не центрируем по
            // ним: иначе половина «0» и «3×» вылезает за шкалу.
            className={clsx("absolute whitespace-nowrap", tick !== 0 && tick !== 3 && "-translate-x-1/2")}
            style={tick === 3 ? { right: 0 } : { left: `${pct(tick)}%` }}
          >
            {tick === 0 ? "0" : `${tick}×`}
          </span>
        ))}
      </div>
      {doneAtr != null && doneAtr > 0 && (
        <div className="mt-0.5 text-[10px] text-faint">
          <span className="mr-1 inline-block h-2 w-0.5 translate-y-[1px] rounded bg-fg" />
          сегодня пройдено {doneAtr.toFixed(2)}×ATR
        </div>
      )}
    </div>
  );
}

/**
 * «Ход инструмента» — блок, который переводит цифры в ATR на человеческий
 * язык. Слева всегда сам ATR (для обоих сетапов), справа — только для
 * ложного пробоя: сколько бару нужно пройти СЕГОДНЯ, чтобы дойти до уровня,
 * проколоть его и вернуться, и насколько такой день типичен. Для пробоя
 * правой половины нет: там путь до уровня уже пройден вчерашним закрытием,
 * и справа стоит именно это.
 */
function AtrPanel({
  setup,
  candles,
  liveBarAt,
}: {
  setup: LevelSetup;
  candles: Candle[] | null;
  /** Момент, на который актуален сегодняшний бар (null — данные из суточного скана). */
  liveBarAt: number | null;
}) {
  const atr = setup.atr;
  if (!(atr > 0)) return null;
  const atrPctOfPrice = (atr / setup.currentPrice) * 100;

  // Сегодняшний (незакрытый) бар — он идёт после дня, по которому считали
  // анализ. Если его ещё нет, живую часть просто не показываем.
  const analysedTo = Date.parse(setup.candlesTo);
  const liveBar = candles?.find((c) => c.t > analysedTo) ?? null;
  const progress = liveBar ? todayProgress(liveBar.h, liveBar.l, atr) : null;
  const livePrice = liveBar?.c ?? null;

  // База расчёта — цена анализа, ТА ЖЕ, что в свёрнутой шапке карточки:
  // иначе на одном экране висели бы два разных «нужен ход». Живая цена
  // показывается отдельной строкой ниже, когда успела заметно уйти.
  const returnAtr = num(setup.returnMoveAtr);
  // У 2Б цена уже ЗА уровнем: бюджет — не путь до уровня, а обратный путь.
  const budget =
    setup.bias === "false_breakout"
      ? falseBreakoutBudget(setup.currentPrice, setup.levelPrice, atr)
      : setup.bias === "false_breakout_2b" && returnAtr !== null
        ? returnMoveBudget(returnAtr, atr)
        : null;
  const is2b = setup.bias === "false_breakout_2b";
  // Пробили вверх — возврат это уход ПОД уровень, и наоборот. Считаем по
  // живой цене: сетап рассчитан по вчерашнему закрытию и за сегодня мог уже
  // отработать.
  const returned2bToday =
    is2b && livePrice !== null && (setup.direction === "short" ? livePrice < setup.levelPrice : livePrice > setup.levelPrice);
  const liveBudget =
    budget && !is2b && livePrice !== null ? falseBreakoutBudget(livePrice, setup.levelPrice, atr) : null;
  // «Заметно» — от 0.1 ATR разницы: меньше не меняет решения, а строку бы
  // добавляло каждый раз.
  const liveShifted = liveBudget !== null && Math.abs(liveBudget.totalAtr - budget!.totalAtr) >= 0.1;
  const closeDistanceAtr = num(setup.quality?.closeDistanceAtr);

  return (
    <div className="rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="grid gap-3 sm:grid-cols-2 sm:divide-x sm:divide-border">
        <div className="sm:pr-3">
          <div className="text-[11px] uppercase tracking-wide text-faint">ATR — средний дневной ход</div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-lg font-semibold">{fmtAtrPrice(atr)}</span>
            <span className="text-xs text-muted">≈ {atrPctOfPrice.toFixed(1)}% цены</span>
          </div>
          <div className="mt-1 text-xs text-muted">
            Столько инструмент проходит за день в среднем: хай минус лоу, усреднённые по пяти последним
            обычным дням (слишком большие и слишком мелкие бары в расчёт не идут).
          </div>
          {progress && (
            <div className="mt-2 text-xs">
              <span className="text-faint">
                Сегодня уже пройдено{liveBarAt ? ` (на ${fmtTime(liveBarAt)})` : " (по данным ночного скана)"}:{" "}
              </span>
              <span className={progress.exhausted ? "text-warn" : "text-fg"}>
                {progress.movedAtr.toFixed(2)}×ATR ({Math.round(progress.movedPct)}%)
              </span>
              {progress.exhausted && (
                <span className="text-warn"> — дневной ход почти выбран, на импульс сегодня рассчитывать поздно</span>
              )}
            </div>
          )}
        </div>

        <div className="sm:pl-3">
          {budget ? (
            <>
              <div className="text-[11px] uppercase tracking-wide text-faint">
                {is2b ? "Чтобы ЛП2Б состоялся завтра" : "Чтобы ложный пробой состоялся сегодня"}
              </div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className={clsx("text-lg font-semibold", FEASIBILITY[budget.feasibility].text)}>
                  {budget.totalAtr.toFixed(2)}×ATR
                </span>
                <span className="text-xs text-muted">
                  {is2b ? "обратный путь" : "размах бара"} ≈ {fmtAtrPrice(budget.totalPrice)}
                </span>
              </div>
              {/* У 2Б бюджет считается на ЗАВТРАШНИЙ бар, поэтому ход,
                  сделанный сегодня, на этой шкале не отмечаем — он про другой
                  день и только путал бы. */}
              <AtrRuler
                needAtr={budget.totalAtr}
                doneAtr={is2b ? undefined : progress?.movedAtr}
                tone={budget.feasibility}
              />
              <div className="mt-2 text-xs text-muted">
                {is2b ? (
                  <>
                    Уровень уже пробит, и закрылись всего в {(budget.totalAtr - 0.08).toFixed(2)}×ATR за ним —
                    завтрашнему бару остаётся вернуть цену обратно под уровень. Это короткий путь: в отличие от
                    обычного ЛП, идти до уровня уже не нужно.
                  </>
                ) : (
                  <>
                    Дойти до уровня — {budget.toLevelAtr.toFixed(2)}×ATR, проколоть его — ещё{" "}
                    {budget.pierceAtr.toFixed(2)}×ATR, и всё это одним баром, с возвратом обратно.
                  </>
                )}
              </div>
              <div className="mt-1 text-xs">
                <span className={FEASIBILITY[budget.feasibility].text}>
                  {FEASIBILITY[budget.feasibility].note}
                </span>
                <span className="text-faint">
                  {" "}
                  — такой размах бывает примерно в {Math.round(budget.oddsShare * 100)}% дней
                  {budget.feasibility !== "routine" && "; ход в пределах 1×ATR — в 80%"}.
                </span>
              </div>
              {is2b && returned2bToday && (
                <div className="mt-1 text-xs text-profit">
                  Возврат уже начался: сегодня цена ушла обратно за уровень ({fmtAtrPrice(livePrice!)}). Сетап
                  отрабатывается прямо сейчас, заготовка на завтра может быть уже неактуальна.
                </div>
              )}
              {liveShifted && liveBudget && (
                <div className="mt-1 text-xs text-faint">
                  Считаем от цены закрытия {fmtDate(setup.candlesTo)}. Сейчас цена {fmtAtrPrice(livePrice!)} — от
                  неё нужно{" "}
                  <span className={FEASIBILITY[liveBudget.feasibility].text}>
                    {liveBudget.totalAtr.toFixed(2)}×ATR
                  </span>
                  .
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-[11px] uppercase tracking-wide text-faint">Путь до уровня</div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-lg font-semibold text-profit">
                  {closeDistanceAtr !== null ? `${closeDistanceAtr.toFixed(2)}×ATR` : "вплотную"}
                </span>
                {closeDistanceAtr !== null && (
                  <span className="text-xs text-muted">≈ {fmtAtrPrice(closeDistanceAtr * atr)}</span>
                )}
              </div>
              <div className="mt-2 text-xs text-muted">
                Для пробоя весь путь уже пройден: вчерашний день закрылся вплотную к уровню, и бару остаётся
                только пройти сам уровень — отдельный запас хода на подход не нужен.
              </div>
              {progress && !progress.exhausted && (
                <div className="mt-1 text-xs text-faint">
                  Из дневного хода не израсходовано ещё {progress.leftAtr.toFixed(2)}×ATR (≈{" "}
                  {fmtAtrPrice(progress.leftAtr * atr)}).
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SetupCard({ setup }: { setup: LevelSetup }) {
  const [open, setOpen] = useState(false);
  // Требуемый ход показываем и в свёрнутой шапке: по нему список
  // просматривают, не раскрывая каждую карточку. Считается от цены анализа —
  // живые свечи в свёрнутом виде ещё не загружены.
  const headReturnAtr = num(setup.returnMoveAtr);
  const headBudget =
    setup.bias === "false_breakout"
      ? falseBreakoutBudget(setup.currentPrice, setup.levelPrice, setup.atr)
      : setup.bias === "false_breakout_2b" && headReturnAtr !== null
        ? returnMoveBudget(headReturnAtr, setup.atr)
        : null;
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [liveBarAt, setLiveBarAt] = useState<number | null>(null);
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
          setLiveBarAt(typeof j.liveBarAt === "number" ? j.liveBarAt : null);
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

  // Без overflow-hidden: он обрезал бы подсказки, вылезающие за карточку.
  // Скругление перенесено на саму кнопку, чтобы её фон при наведении не
  // выходил за уголки.
  return (
    <div className="rounded-xl border border-border bg-surface-1">
      <button
        onClick={toggle}
        className={clsx(
          "w-full flex items-center gap-3 p-4 text-left hover:bg-surface-2 transition rounded-t-xl",
          !open && "rounded-b-xl",
        )}
      >
        <div className="flex-1 min-w-0">
          <div className="relative flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{setup.symbol}</span>
            <BiasBadge bias={setup.bias} direction={setup.direction} />
            <Hint
              text={`Как построен уровень: ${levelTypeLabel(setup.levelType)}. Тип показывает, откуда взялась эта цена — например откат, слом структуры, зеркальный уровень или локальная опорная точка. Чем «структурнее» тип, тем чаще рынок его уважает.`}
              className="text-xs text-muted"
            >
              {levelTypeLabel(setup.levelType)}
            </Hint>
          </div>
          <div className="relative text-sm text-muted mt-1">
            <Hint text="Цена уровня — линия, от которой считается весь сетап. Именно её цена должна пробить (для пробоя) или проколоть и вернуться (для ложного пробоя).">
              Уровень {setup.levelPrice}
            </Hint>{" "}
            ·{" "}
            <Hint text={`Цена закрытия последнего проанализированного дня (${fmtDate(setup.candlesTo)}). Сегодняшний день ещё идёт и в расчёт сетапа не входит — раскройте карточку, чтобы увидеть текущее состояние.`}>
              цена {setup.currentPrice}
            </Hint>{" "}
            ·{" "}
            <Hint
              text={
                setup.bias === "false_breakout_2b"
                  ? `Насколько цена уже ушла ЗА уровень — она его пробила и закрылась с другой стороны. Измеряется в ATR, среднем дневном ходе инструмента: ${setup.distanceAtr.toFixed(2)}×ATR это ${(setup.distanceAtr * 100).toFixed(0)}% обычного дневного движения.`
                  : `Сколько цене осталось пройти до уровня, в ATR — среднем дневном ходе инструмента. ${setup.distanceAtr.toFixed(2)}×ATR значит ${(setup.distanceAtr * 100).toFixed(0)}% обычного дневного движения: чем меньше, тем ближе цена к уровню.`
              }
            >
              {setup.bias === "false_breakout_2b" ? "за уровнем" : "до уровня"}{" "}
              {setup.distanceAtr.toFixed(2)}×ATR
            </Hint>{" "}
            ·{" "}
            <Hint text={`Сила уровня — сколько раз рынок на него отреагировал: касания, отбои, развороты. Здесь ${setup.strength}. Чем больше, тем больше участников видят эту цену и тем серьёзнее уровень.`}>
              сила {setup.strength}
            </Hint>
            {headBudget && (
              <>
                {" · "}
                <Hint
                  text={
                    setup.bias === "false_breakout_2b"
                      ? `Сколько завтрашнему бару пройти, чтобы вернуть цену обратно за уровень: ${headBudget.totalAtr.toFixed(2)}×ATR. ${FEASIBILITY[headBudget.feasibility].note[0].toUpperCase()}${FEASIBILITY[headBudget.feasibility].note.slice(1)}: встречается примерно в ${Math.round(headBudget.oddsShare * 100)}% торговых дней.`
                      : `Сколько сегодняшнему бару нужно пройти, чтобы сетап состоялся: дойти до уровня, проколоть его и вернуться — итого ${headBudget.totalAtr.toFixed(2)}×ATR размаха. ${FEASIBILITY[headBudget.feasibility].note[0].toUpperCase()}${FEASIBILITY[headBudget.feasibility].note.slice(1)}: встречается примерно в ${Math.round(headBudget.oddsShare * 100)}% торговых дней.`
                  }
                  className={FEASIBILITY[headBudget.feasibility].text}
                >
                  {setup.bias === "false_breakout_2b" ? "возврат" : "нужен ход"}{" "}
                  {headBudget.totalAtr.toFixed(2)}×ATR
                </Hint>
              </>
            )}
            {setup.lastVolume != null && (
              <>
                {" · "}
                <Hint
                  text={`Оборот за последний день в долларах. Это про ликвидность: на тонком рынке цена ходит рывками, а вход и выход дороже из-за проскальзывания. Цвет: до $10 млн — тонко (красный), $10-20 млн — средне (жёлтый), больше $20 млн — комфортно (зелёный).`}
                  className={volumeClass(setup.lastVolume)}
                >
                  объём {fmtVolume(setup.lastVolume)}
                </Hint>
              </>
            )}
          </div>
        </div>
        {open ? <ChevronUp size={16} className="shrink-0" /> : <ChevronDown size={16} className="shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="text-xs text-faint">
            {setup.bias === "false_breakout_2b"
              ? setup.currentPrice >= setup.levelPrice
                ? "Уровень пробит вверх, закрылись над ним"
                : "Уровень пробит вниз, закрылись под ним"
              : setup.levelPrice >= setup.currentPrice
                ? "Уровень выше цены"
                : "Уровень ниже цены"}{" "}
            · {BIAS_LABELS[setup.bias].toLowerCase()} отсюда отрабатывается в{" "}
            <span className={setup.direction === "long" ? "text-profit" : "text-loss"}>
              {directionLabel(setup.direction)}
            </span>
          </div>
          <AtrPanel setup={setup} candles={candles} liveBarAt={liveBarAt} />

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

  // Счётчик на кнопке — сколько карточек останется, если её нажать СЕЙЧАС,
  // то есть с учётом фильтра другой строки. Иначе «Шорт 40» рядом с
  // «ЛП2Б», где шортов всего три, обещал бы не то, что покажет клик.
  const countBias = (key: Bias | "all") =>
    setups.filter(
      (s) => (key === "all" || s.bias === key) && (directionFilter === "all" || s.direction === directionFilter),
    ).length;
  const countDirection = (key: Direction | "all") =>
    setups.filter((s) => (filter === "all" || s.bias === filter) && (key === "all" || s.direction === key)).length;
  const biasCounts = Object.fromEntries(BIAS_FILTERS.map((f) => [f.key, countBias(f.key)])) as Record<
    Bias | "all",
    number
  >;
  const directionCounts = Object.fromEntries(DIRECTION_FILTERS.map((f) => [f.key, countDirection(f.key)])) as Record<
    Direction | "all",
    number
  >;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Рекомендации</h1>
        <p className="text-sm text-muted mt-1">
          Инструменты, готовые к торговле сегодня: из всех бессрочных USDT-контрактов Binance — крипта плюс
          золото, серебро и акции — остаются только те, где
          вчерашний день закрылся вплотную к уровню, слева нет распила и глубоких ложных пробоев, а за
          уровнем пусто. Уровни берём только свежие — образованные за последние полгода. На инструмент — один, самый сильный сетап. Не сигнал «покупай/продавай» — только
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
              biasCounts[f.key] === 0 && filter !== f.key && "opacity-50",
            )}
          >
            {f.label} <FilterCount value={biasCounts[f.key]} active={filter === f.key} />
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
              directionCounts[f.key] === 0 && directionFilter !== f.key && "opacity-50",
            )}
          >
            {f.label} <FilterCount value={directionCounts[f.key]} active={directionFilter === f.key} />
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
