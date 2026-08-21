/**
 * Профиль объёма по ВИДИМОМУ участку графика (VPVR — Volume Profile Visible
 * Range) для наложения на свечи.
 *
 * Зачем отдельно от панели «Профиль объёма»: панель считает профиль за
 * фиксированный период (роуты volume-profile с параметром period), и как
 * наложение это читается неверно: на часовом таймфрейме период равен часу, а
 * на экране — две недели свечей. Профиль последнего часа, растянутый поверх
 * двух недель, выглядит как уровни всего периода, хотя ими не является.
 *
 * Здесь профиль всегда описывает ровно то, что видно, и пересчитывается при
 * каждом зуме/панораме. Считается на клиенте из уже загруженных данных —
 * никаких дополнительных запросов.
 *
 * Источники по страницам разные, поэтому две входные точки:
 *   • forex — OHLCV-свечи: объём свечи размазывается по её диапазону
 *     high–low (та же аппроксимация, что и на сервере: точнее из свечей
 *     не получить);
 *   • orderflow — footprint: реальный объём по каждой цене, аппроксимация не
 *     нужна.
 *
 * Ограничение по footprint: он хранится заметно короче свечей
 * (OB_TRADE_RETENTION_DAYS), поэтому на дальних таймфреймах профиль
 * описывает только ту часть видимого окна, по которой footprint ещё есть.
 */
import type { VolumeProfile, VolumeProfileLevel } from "@/components/VolumeProfile";
import type { FootprintCandle } from "@/lib/orderflow";

/** Сколько ценовых бинов в профиле. */
const DEFAULT_BINS = 60;
/** Доля объёма внутри Value Area — стандартные 70%. */
const VALUE_AREA_PCT = 0.7;

export type ProfileBar = { t: number; h: number; l: number; v: number };

/** Собирает профиль из уже разложенных по бинам объёмов. */
function buildProfile(binVolumes: number[], minPrice: number, binSize: number): VolumeProfile | null {
  let total = 0;
  let pocIdx = -1;
  let pocVolume = 0;
  for (let i = 0; i < binVolumes.length; i++) {
    const v = binVolumes[i];
    total += v;
    if (v > pocVolume) { pocVolume = v; pocIdx = i; }
  }
  if (pocIdx < 0 || total <= 0) return null;

  // Value Area: растём от POC в ту сторону, где объём соседа больше, пока не
  // наберём 70% общего объёма — классический алгоритм рыночного профиля.
  let lo = pocIdx;
  let hi = pocIdx;
  let acc = pocVolume;
  const target = total * VALUE_AREA_PCT;
  while (acc < target && (lo > 0 || hi < binVolumes.length - 1)) {
    const below = lo > 0 ? binVolumes[lo - 1] : -1;
    const above = hi < binVolumes.length - 1 ? binVolumes[hi + 1] : -1;
    if (above >= below) { hi++; acc += Math.max(0, above); }
    else { lo--; acc += Math.max(0, below); }
  }

  // Центр бина. Вырожденный случай (вся видимая область в одной цене) — бин
  // ровно один, и его «центр» должен совпасть с самой ценой: иначе POC уезжает
  // на половину синтетической ширины бина и не совпадает с ценой на графике.
  const single = binVolumes.length === 1;
  const priceOf = (i: number) => (single ? minPrice : minPrice + (i + 0.5) * binSize);
  const levels: VolumeProfileLevel[] = binVolumes.map((v, i) => ({
    price: priceOf(i),
    volume: v,
    isPoc: i === pocIdx,
    isVa: i >= lo && i <= hi,
    pct: (v / pocVolume) * 100,
  }));

  return {
    poc: priceOf(pocIdx),
    vah: priceOf(hi) + binSize / 2,
    val: priceOf(lo) - binSize / 2,
    levels,
    totalVolume: total,
    pocVolume,
    valueAreaVolume: acc,
    valueAreaPct: VALUE_AREA_PCT,
    binSize,
  };
}

function binIndex(price: number, minPrice: number, binSize: number, bins: number): number {
  const i = Math.floor((price - minPrice) / binSize);
  return i < 0 ? 0 : i >= bins ? bins - 1 : i;
}

/**
 * Профиль из OHLCV-свечей: объём каждой свечи распределяется равномерно по
 * бинам, которые накрывает её диапазон high–low.
 */
export function profileFromCandles(
  candles: ProfileBar[],
  fromMs: number,
  toMs: number,
  bins = DEFAULT_BINS,
): VolumeProfile | null {
  const visible = candles.filter((c) => c.t >= fromMs && c.t <= toMs && c.v > 0);
  if (visible.length === 0) return null;

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const c of visible) {
    if (c.l < minPrice) minPrice = c.l;
    if (c.h > maxPrice) maxPrice = c.h;
  }
  const span = maxPrice - minPrice;
  // Плоский участок (все свечи в одной цене) — один бин, иначе делим на ноль.
  const binSize = span > 0 ? span / bins : Math.max(maxPrice * 1e-6, Number.EPSILON);
  const count = span > 0 ? bins : 1;

  const binVolumes = new Array<number>(count).fill(0);
  for (const c of visible) {
    const lowIdx = binIndex(c.l, minPrice, binSize, count);
    const highIdx = binIndex(c.h, minPrice, binSize, count);
    const touched = highIdx - lowIdx + 1;
    const share = c.v / touched;
    for (let i = lowIdx; i <= highIdx; i++) binVolumes[i] += share;
  }
  return buildProfile(binVolumes, minPrice, binSize);
}

/**
 * Профиль из footprint: у каждой свечи есть реальный объём по каждой цене,
 * размазывать ничего не нужно.
 */
export function profileFromFootprint(
  candles: FootprintCandle[],
  fromMs: number,
  toMs: number,
  bins = DEFAULT_BINS,
): VolumeProfile | null {
  const visible = candles.filter((c) => c.t >= fromMs && c.t <= toMs && c.levels.length > 0);
  if (visible.length === 0) return null;

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const c of visible) {
    for (const l of c.levels) {
      if (l.price < minPrice) minPrice = l.price;
      if (l.price > maxPrice) maxPrice = l.price;
    }
  }
  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) return null;

  const span = maxPrice - minPrice;
  const binSize = span > 0 ? span / bins : Math.max(maxPrice * 1e-6, Number.EPSILON);
  const count = span > 0 ? bins : 1;

  const binVolumes = new Array<number>(count).fill(0);
  for (const c of visible) {
    for (const l of c.levels) {
      binVolumes[binIndex(l.price, minPrice, binSize, count)] += l.buy + l.sell;
    }
  }
  return buildProfile(binVolumes, minPrice, binSize);
}
