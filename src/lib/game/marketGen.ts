// Генератор общего рынка. Чистые функции: одинаковые вход и номер бара
// всегда дают одинаковую цену.
//
// Почему так, а не «сервер крутит симуляцию в фоне»: детерминированность
// позволяет доганять историю кусками, в любом порядке, с любого инстанса и
// после любого простоя — и не бояться, что у двух игроков разъедутся
// котировки. Фоновый процесс пришлось бы держать живым круглосуточно, а при
// падении — восстанавливать по журналу.
//
// Устройство истории (см. также миграцию 20260905090000_game_market):
//   • ЧАСОВОЙ ряд — костяк. Цепочка баров от начала истории инструмента до
//     текущего часа; только он и дневная свёртка лежат в базе.
//   • МИНУТКИ не хранятся вообще: они достраиваются внутри часа МОСТОМ
//     БРОУНА (bridgeMinutes) — случайное блуждание, которое по построению
//     выходит ровно из открытия часа в его закрытие. Поэтому минутный и
//     часовой графики не могут разойтись (а два независимых ряда разошлись
//     бы обязательно), база не растёт на полмиллиона строк в сутки, и
//     минутку можно попросить за любой час прошлого.
//   • 5m/15m/4h/1w/1M нигде не хранятся: собираются из хранимых рядов.
import type { Asset, NewsImpact } from "@/engine/entities/types";
import { NEWS_TEMPLATES, IMPACT_WEIGHTS, sectorLabel } from "@/engine/market/newsEngine";
import macroData from "@/data/macroEvents.json";
import { REGIME_PRESETS, REGIME_TRANSITIONS, type RegimePreset } from "@/engine/market/marketRegime";
import type { MarketRegimeType } from "@/engine/entities/types";

export const MS_MINUTE = 60_000;
export const MS_HOUR = 60 * MS_MINUTE;
export const MS_DAY = 24 * MS_HOUR;

// Сколько месяцев истории у инструмента. У каждого своё — «рынок существовал
// не с одного дня»; минимум полгода, максимум полтора.
export const MIN_HISTORY_MONTHS = 6;
export const MAX_HISTORY_MONTHS = 18;

// Корреляция внутри группы инструментов: доля общего шока в шуме каждого.
export const GROUP_CORRELATION = 0.6;

// ── Детерминированная случайность ─────────────────────────────────────────

/** FNV-1a: быстрая и стабильная хэш-функция без зависимостей. */
export function hash32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Одно число 0..1 из ключа — вместо потока RNG, чтобы не зависеть от порядка вызовов. */
export function rand(key: string): number {
  let a = hash32(key);
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Нормальное N(0,1) из двух независимых ключей (Box-Muller). */
export function normal(key: string): number {
  const u1 = Math.max(1e-9, rand(`${key}|a`));
  const u2 = rand(`${key}|b`);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ── Рыночные режимы ───────────────────────────────────────────────────────

export interface RegimeDay {
  type: MarketRegimeType;
  preset: RegimePreset;
}

/**
 * Режим для каждого дня истории. Считается один раз на сид и кэшируется:
 * это цепочка, её нельзя посчитать для произвольного дня, не пройдя путь с
 * начала.
 */
const regimeCache = new Map<string, RegimeDay[]>();

export function regimeTimeline(seed: string, days: number): RegimeDay[] {
  const cacheKey = `${seed}|${days}`;
  const cached = regimeCache.get(cacheKey);
  if (cached) return cached;

  const timeline: RegimeDay[] = [];
  let type: MarketRegimeType = "sideways";
  let daysLeft = 0;
  for (let day = 0; day < days; day++) {
    if (daysLeft <= 0) {
      // Сначала переходим в новый режим, и только потом берём длительность
      // ЕГО пресета. В обратном порядке каждый режим жил ровно столько,
      // сколько положено предыдущему: кризис тянулся неделями, бычий рынок
      // обрывался за день — и доля времени в режимах не имела ничего общего
      // с задуманной (замерено: бычий 19% вместо 52%).
      if (day > 0) type = pickRegime(type, rand(`${seed}|regime|${day}`));
      const preset = REGIME_PRESETS[type];
      const span = preset.maxDurationDays - preset.minDurationDays;
      daysLeft = Math.max(1, Math.round(preset.minDurationDays + rand(`${seed}|regime-len|${day}`) * span));
    }
    timeline.push({ type, preset: REGIME_PRESETS[type] });
    daysLeft--;
  }
  // Кэш маленький (один сид), но на всякий случай не даём ему расти.
  if (regimeCache.size > 8) regimeCache.clear();
  regimeCache.set(cacheKey, timeline);
  return timeline;
}

function pickRegime(current: MarketRegimeType, roll: number): MarketRegimeType {
  const options = REGIME_TRANSITIONS[current];
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  let acc = roll * total;
  for (const [type, weight] of options) {
    acc -= weight;
    if (acc <= 0) return type;
  }
  return options[options.length - 1][0];
}

// ── Новости ───────────────────────────────────────────────────────────────

export interface GeneratedNews {
  ts: number;
  assetId: string | null; // null — весь рынок
  sector: string | null;
  impact: NewsImpact;
  headline: string;
  shockPct: number;
}

// Частота новостей в ИСТОРИИ рынка. Не путать с NEWS_PER_GAME_DAY из
// клиентского движка (24): та величина отвечала за «чтобы за сессию хоть
// что-то произошло», и на живой вкладке это было безобидно. Здесь новости
// применяются к КАЖДОМУ часу полутора лет истории — при 24 в сутки это 13
// тысяч событий, и накопленный шок уводил цены в разы (замерено: золото
// уезжало с 2380 на 614). Четыре в сутки — примерно как значимых новостей на
// реальном рынке, и лента при этом не пустует.
export const NEWS_PER_DAY = 4;

// Насколько новость двигает цену в зависимости от охвата. Макроновость
// шевелит весь рынок понемногу, новость про компанию бьёт по ней целиком —
// без этого различия «глобальные» события накапливались в бессмысленный
// снос по всем инструментам сразу.
export const GLOBAL_SHOCK_SCALE = 0.35;
export const SECTOR_SHOCK_SCALE = 0.6;

// Новость двигает инструмент соразмерно его собственной «нервности».
// Одинаковый шок в 2% — это обычный день для биткоина и событие века для
// EUR/USD: без этой поправки валютные пары за год уезжали на треть, хотя их
// годовая волатильность 8% (замерено: EUR/USD с 1.085 на 0.743).
// 0.3 — опорная волатильность обычной акции.
export const NEWS_VOL_REFERENCE = 0.3;

export function newsVolScale(baseVolatility: number): number {
  return Math.max(0.15, Math.min(3, baseVolatility / NEWS_VOL_REFERENCE));
}

/**
 * Новости часа. Час выбран единицей потому, что это самый крупный бар, в
 * который новость обязана попасть целиком: внутри минутного ряда шок
 * применяется к минуте выхода.
 */
// Во сколько раз реже новости выходят в нерабочее время — ночью и в
// выходные. Не ноль: мир не замирает, когда биржи закрыты, и именно эти
// редкие сообщения объясняют разрыв на открытии в понедельник. Но и не
// поровну: в субботу не публикуют отчётности и не выходит статистика, а
// лента, которая идёт в том же темпе, что в среду, выглядит выдуманной.
export const OFF_HOURS_NEWS_FACTOR = 0.25;

/** Тихое время: суббота, воскресенье и ночь с 22:00 до 07:00 UTC. */
export function isQuietHour(ts: number): boolean {
  const date = new Date(ts);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return true;
  const hour = date.getUTCHours();
  return hour >= 22 || hour < 7;
}

// ── Календарь событий ─────────────────────────────────────────────────────
//
// Часть новостей известна ЗАРАНЕЕ: заседание по ставке, отчёт по занятости,
// публикация инфляции. В настоящей торговле к ним готовятся — и именно
// поэтому у нас был провал: игрок не мог ни к чему подготовиться, любая
// новость приходила ниоткуда.
//
// Календарь показывает, ЧТО и КОГДА выйдет, но не показывает РЕЗУЛЬТАТ:
// направление шока считается в тот же час, что и сама новость, и подсмотреть
// его нельзя — иначе игра сводилась бы к чтению будущего.

/** Сколько запланированных публикаций может быть в один день. */
export const SCHEDULED_SLOTS_PER_DAY = 2;
/** Вероятность, что слот занят. */
export const SCHEDULED_SLOT_CHANCE = 0.55;

export interface MacroEvent {
  id: string;
  impact: NewsImpact;
  title: string;
  shockRange: [number, number];
}

// У запланированных публикаций СВОИ заголовки, а не шаблоны обычных новостей.
// Те написаны под подстановку инструмента или отрасли («квартальный отчёт по
// {sector}»), и в календаре, где ни того ни другого ещё нет, получалось
// «отчёт по — без сюрпризов» или «понизило прогноз по здравоохранение».
// Макрособытие ни к кому не привязано: оно про экономику целиком.
export const MACRO_EVENTS = macroData as MacroEvent[];

export interface ScheduledEvent {
  /** Время публикации. */
  ts: number;
  /** Идентификатор макрособытия. */
  eventId: string;
  /** Заголовок — известен заранее, в отличие от результата. */
  title: string;
  impact: NewsImpact;
}

const SCHEDULED_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Запланировано ли событие ровно на этот час.
 *
 * Считается от номера суток и номера слота, поэтому один и тот же час у всех
 * игроков даёт один и тот же ответ — как и всё остальное в этом генераторе.
 */
export function scheduledAt(seed: string, ts: number): ScheduledEvent | null {
  const date = new Date(ts);
  const day = date.getUTCDay();
  // В выходные макростатистику не публикуют. Это же спасает от нелепости
  // «заседание центробанка в воскресенье в календаре».
  if (day === 0 || day === 6) return null;
  const dayNum = Math.floor(ts / SCHEDULED_DAY_MS);
  const hour = date.getUTCHours();

  for (let slot = 0; slot < SCHEDULED_SLOTS_PER_DAY; slot++) {
    if (rand(`${seed}|cal-on|${dayNum}|${slot}`) >= SCHEDULED_SLOT_CHANCE) continue;
    // Публикации приходятся на рабочие часы: 8-17 UTC.
    const slotHour = 8 + Math.floor(rand(`${seed}|cal-h|${dayNum}|${slot}`) * 10);
    if (slotHour !== hour) continue;
    const event = MACRO_EVENTS[Math.floor(rand(`${seed}|cal-ev|${dayNum}|${slot}`) * MACRO_EVENTS.length) % MACRO_EVENTS.length];
    return { ts: Math.floor(ts / MS_HOUR) * MS_HOUR, eventId: event.id, title: event.title, impact: event.impact };
  }
  return null;
}

/** Расписание публикаций на промежуток — то, что показывает календарь. */
export function scheduleBetween(seed: string, fromTs: number, toTs: number): ScheduledEvent[] {
  const out: ScheduledEvent[] = [];
  const start = Math.floor(fromTs / MS_HOUR) * MS_HOUR;
  for (let ts = start; ts <= toTs; ts += MS_HOUR) {
    const event = scheduledAt(seed, ts);
    if (event) out.push(event);
  }
  return out;
}

export function newsForHour(
  seed: string,
  hourIndex: number,
  assets: Asset[],
  drift: number,
  // Абсолютное время часа — по нему решается, тихое оно или рабочее.
  // Необязательное: расчёты, которым лента не важна, передают только индекс.
  ts?: number,
): GeneratedNews[] {
  // Запланированная публикация выходит ВСЕГДА: если календарь обещал
  // событие на этот час, а его не случилось, календарь врёт — и готовиться
  // по нему больше никто не станет.
  const scheduled = ts != null ? scheduledAt(seed, ts) : null;

  const quiet = ts != null && isQuietHour(ts);
  const lambda = (NEWS_PER_DAY / 24) * (quiet ? OFF_HOURS_NEWS_FACTOR : 1);
  const roll = rand(`${seed}|news|${hourIndex}`);
  if (!scheduled && roll >= 1 - Math.exp(-lambda)) return [];

  const macro = scheduled ? MACRO_EVENTS.find((item) => item.id === scheduled.eventId) : undefined;
  const impact = scheduled ? scheduled.impact : pickImpact(rand(`${seed}|news-impact|${hourIndex}`));
  const direction = rand(`${seed}|news-dir|${hourIndex}`) < 0.5 + Math.max(-0.25, Math.min(0.25, drift * 0.08)) ? 1 : -1;
  const wanted = direction === 1 ? "positive" : "negative";
  const pool = NEWS_TEMPLATES.filter((t) => t.impact === impact && (t.polarity === wanted || t.polarity === "mixed"));
  const candidates = pool.length > 0 ? pool : NEWS_TEMPLATES.filter((t) => t.impact === impact);
  if (candidates.length === 0 || assets.length === 0) return [];

  const template = candidates[Math.floor(rand(`${seed}|news-tpl|${hourIndex}`) * candidates.length) % candidates.length];
  const asset = assets[Math.floor(rand(`${seed}|news-asset|${hourIndex}`) * assets.length) % assets.length];
  const sectors = Array.from(new Set(assets.map((a) => a.sector).filter((s): s is string => !!s)));
  const sector =
    template.targetType === "sector" && sectors.length > 0
      ? sectors[Math.floor(rand(`${seed}|news-sector|${hourIndex}`) * sectors.length) % sectors.length]
      : null;

  // У макрособытия своя сила и свой заголовок: игрок готовился к «решению по
  // ставке» — он и должен его увидеть. Направление при этом случайное:
  // результат публикации заранее не известен, в этом и смысл.
  const [lo, hi] = macro ? macro.shockRange : template.shockRange;
  const magnitude = lo + rand(`${seed}|news-mag|${hourIndex}`) * (hi - lo);
  const sign = macro ? direction : template.polarity === "positive" ? 1 : template.polarity === "negative" ? -1 : direction;

  if (macro) {
    return [
      {
        ts: hourIndex * MS_HOUR,
        assetId: null,
        sector: null,
        impact,
        headline: macro.title,
        shockPct: magnitude * sign,
      },
    ];
  }

  return [
    {
      ts: hourIndex * MS_HOUR,
      assetId: template.targetType === "asset" && !sector ? asset.id : null,
      sector,
      impact,
      headline: template.template
        .replace("{asset}", asset.name)
        .replace("{sector}", sector ? sectorLabel(sector) : asset.sector ? sectorLabel(asset.sector) : asset.name)
        .replace("{assetClass}", asset.assetClass),
      shockPct: magnitude * sign,
    },
  ];
}

function pickImpact(roll: number): NewsImpact {
  let acc = 0;
  for (const [impact, weight] of Object.entries(IMPACT_WEIGHTS) as [NewsImpact, number][]) {
    acc += weight;
    if (roll < acc) return impact;
  }
  return "low";
}

/** Задевает ли новость инструмент. */
export function newsHits(news: GeneratedNews, asset: Asset): boolean {
  if (news.assetId) return news.assetId === asset.id;
  if (news.sector) return asset.sector === news.sector;
  return true; // глобальная
}

/** Множитель цены от новости: падение — деление, рост — умножение. */
export function shockFactor(shockPct: number): number {
  return shockPct >= 0 ? 1 + shockPct : 1 / (1 - shockPct);
}

// ── Свечи ─────────────────────────────────────────────────────────────────

export interface GeneratedCandle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const MS_PER_YEAR = 365 * MS_DAY;

/** Сколько месяцев истории у конкретного инструмента (детерминированно). */
export function historyMonths(seed: string, assetId: string): number {
  const span = MAX_HISTORY_MONTHS - MIN_HISTORY_MONTHS;
  return MIN_HISTORY_MONTHS + Math.floor(rand(`${seed}|history|${assetId}`) * (span + 1));
}

export interface StepContext {
  seed: string;
  asset: Asset;
  /** "h" для часового ряда, "m" для минутного — ключи не должны пересекаться. */
  kind: "h" | "m";
  stepMs: number;
  regimes: RegimeDay[];
  /** Абсолютное время начала бара, мс. */
  ts: number;
  /** Индекс бара внутри своего ряда. */
  index: number;
  /** Новости, попавшие в этот бар. */
  news: GeneratedNews[];
}

/**
 * Один бар: цена идёт по той же формуле 3.2 (GBM), что и раньше в клиенте, —
 * только шок берётся не из потока RNG, а из ключа «инструмент + номер бара»,
 * поэтому бар можно пересчитать в любой момент и получить то же самое.
 */
export function nextCandle(prev: number, ctx: StepContext): GeneratedCandle {
  const { seed, asset, kind, stepMs, regimes, ts, index, news } = ctx;
  const dayIndex = Math.max(0, Math.floor(ts / MS_DAY));
  const regime = regimes[Math.min(regimes.length - 1, dayIndex)] ?? regimes[regimes.length - 1];
  const dtYears = stepMs / MS_PER_YEAR;

  // Общий шок группы: инструменты одного сектора ходят вместе.
  const groupZ = normal(`${seed}|g|${asset.correlationGroup}|${kind}|${index}`);
  const ownZ = normal(`${seed}|z|${asset.id}|${kind}|${index}`);
  const z = GROUP_CORRELATION * groupZ + Math.sqrt(1 - GROUP_CORRELATION ** 2) * ownZ;

  const mu = asset.baseDrift * regime.preset.driftModifier;
  const sigma = asset.baseVolatility * regime.preset.volModifier;
  const open = prev;
  // Без члена −0.5σ²: снос задаёт МЕДИАННУЮ траекторию, а не математическое
  // ожидание. У классического GBM медиана уезжает вниз тем сильнее, чем выше
  // волатильность (у биткоина с σ=0.7 это −24% в год на ровном месте), и
  // «типичный» игрок видел бы падение там, где по замыслу рост. Для игры
  // важно именно то, что видит типичный игрок.
  let close = open * Math.exp(mu * dtYears + sigma * Math.sqrt(dtYears) * z);

  for (const item of news) {
    if (!newsHits(item, asset)) continue;
    const reach = item.assetId ? 1 : item.sector ? SECTOR_SHOCK_SCALE : GLOBAL_SHOCK_SCALE;
    close *= shockFactor(item.shockPct * reach * newsVolScale(asset.baseVolatility));
  }

  // Тени: доля движения, отложенная в обе стороны. Без них бар выглядит
  // «нарисованным» — только тело, ни одного фитиля.
  const range = Math.abs(close - open);
  const wickUp = range * rand(`${seed}|wu|${asset.id}|${kind}|${index}`) * 0.9 + open * sigma * Math.sqrt(dtYears) * 0.35;
  const wickDown = range * rand(`${seed}|wd|${asset.id}|${kind}|${index}`) * 0.9 + open * sigma * Math.sqrt(dtYears) * 0.35;
  const high = Math.max(open, close) + wickUp;
  const low = Math.max(asset.tickSize, Math.min(open, close) - wickDown);

  const move = Math.abs(close - open) / (open || 1);
  const volume = 40 * (1 + move * 400) * (0.4 + rand(`${seed}|v|${asset.id}|${kind}|${index}`) * 1.2) * (stepMs / MS_MINUTE);

  const round = (value: number) => {
    const tick = asset.tickSize > 0 ? asset.tickSize : 0.01;
    return Math.round(value / tick) * tick;
  };

  return {
    ts,
    open: round(open),
    high: round(high),
    low: round(low),
    close: round(Math.max(asset.tickSize, close)),
    volume: Math.round(volume),
  };
}

/** Склейка баров в более крупный таймфрейм. */
export function aggregate(candles: GeneratedCandle[], bucketMs: number): GeneratedCandle[] {
  const out: GeneratedCandle[] = [];
  let current: GeneratedCandle | null = null;
  let bucket = NaN;
  for (const candle of candles) {
    const start = Math.floor(candle.ts / bucketMs) * bucketMs;
    if (!current || start !== bucket) {
      if (current) out.push(current);
      current = { ...candle, ts: start };
      bucket = start;
      continue;
    }
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
  }
  if (current) out.push(current);
  return out;
}

// ── Минутки внутри часа: мост Броуна ──────────────────────────────────────

export const MINUTES_PER_HOUR = 60;

/**
 * Случайное блуждание, закреплённое на обоих концах: выходит ровно из open
 * часа и приходит ровно в его close. Обычное блуждание пришло бы «куда
 * получится», и часовой бар перестал бы соответствовать своим минуткам —
 * игрок увидел бы, что на минутном графике цена одна, а на часовом другая.
 *
 * Формула: log-цена = линейная интерполяция между log(open) и log(close)
 * плюс мост B(m) − (m/N)·B(N), где B — накопленная сумма нормальных
 * приращений. Второе слагаемое обнуляется на обоих концах — отсюда и
 * закрепление.
 */
export function bridgeMinutes(
  hour: GeneratedCandle,
  asset: Asset,
  seed: string,
  hourIndex: number,
  count = MINUTES_PER_HOUR,
): GeneratedCandle[] {
  const open = hour.open;
  const close = hour.close;
  if (!(open > 0) || !(close > 0)) return [];

  // Накопленные приращения моста. Ключ включает индекс часа, поэтому минутки
  // одного и того же часа всегда одинаковы.
  const steps: number[] = [0];
  for (let m = 1; m <= MINUTES_PER_HOUR; m++) {
    steps.push(steps[m - 1] + normal(`${seed}|bridge|${asset.id}|${hourIndex}|${m}`));
  }
  const total = steps[MINUTES_PER_HOUR];
  const logOpen = Math.log(open);
  const logClose = Math.log(close);
  // Амплитуда шума внутри часа: часовая волатильность, разложенная на
  // минуты. Слишком большая — минутки вылезут за тени часа, слишком
  // маленькая — прямая линия вместо графика.
  const sigma = (asset.baseVolatility / Math.sqrt(365 * 24)) * 0.55;

  const priceAt = (m: number) => {
    const ratio = m / MINUTES_PER_HOUR;
    const bridge = steps[m] - ratio * total;
    return Math.exp(logOpen + (logClose - logOpen) * ratio + sigma * bridge);
  };

  const tick = asset.tickSize > 0 ? asset.tickSize : 0.01;
  const round = (value: number) => Math.round(value / tick) * tick;
  const limit = Math.max(1, Math.min(MINUTES_PER_HOUR, count));
  const out: GeneratedCandle[] = [];
  for (let m = 0; m < limit; m++) {
    const o = priceAt(m);
    const c = priceAt(m + 1);
    const wick = Math.abs(c - o) * rand(`${seed}|bw|${asset.id}|${hourIndex}|${m}`) * 0.6;
    const volume = Math.max(1, hour.volume / MINUTES_PER_HOUR) * (0.4 + rand(`${seed}|bv|${asset.id}|${hourIndex}|${m}`) * 1.2);
    out.push({
      ts: hour.ts + m * MS_MINUTE,
      open: round(o),
      high: round(Math.max(o, c) + wick),
      low: round(Math.max(tick, Math.min(o, c) - wick)),
      close: round(c),
      volume: Math.round(volume),
    });
  }
  return out;
}

// ── Гэп после перерыва ────────────────────────────────────────────────────

// Какая доля движения, которое рынок прошёл бы за время простоя, выплёскивается
// в разрыв на открытии. Не единица: за выходные новостей меньше, чем за двое
// рабочих суток, а часть информации уже была в цене до закрытия. 0.35 даёт
// на выходных по паре EUR/USD (σ≈0.08) разрыв порядка десятых долей процента,
// по акции (σ≈0.35) — процент-полтора: примерно то, что видно на реальных
// графиках понедельника.
export const GAP_INFO_SHARE = 0.35;
// Потолок разрыва: без него редкий хвост нормального распределения на длинных
// новогодних перерывах рисует обвал на ровном месте.
export const MAX_GAP = 0.12;

/**
 * Цена открытия первого бара после перерыва.
 *
 * Считается ровно как обычный шаг генератора, только за «сжатое» время
 * простоя: рынок стоял, а мир жил. Отдельная функция, а не флаг внутри
 * nextCandle, потому что разрыв — это про ОТКРЫТИЕ следующего бара, тогда
 * как nextCandle всегда открывается там, где закрылся предыдущий.
 */
export function gapOpen(
  prevClose: number,
  params: { seed: string; asset: Asset; index: number; closedMs: number; volModifier: number },
): number {
  const { seed, asset, index, closedMs, volModifier } = params;
  if (closedMs <= 0) return prevClose;
  const dtYears = (closedMs * GAP_INFO_SHARE) / MS_PER_YEAR;
  const sigma = asset.baseVolatility * volModifier;
  const z = normal(`${seed}|gap|${asset.id}|${index}`);
  const move = Math.max(-MAX_GAP, Math.min(MAX_GAP, sigma * Math.sqrt(dtYears) * z));
  return Math.max(asset.tickSize, prevClose * Math.exp(move));
}
