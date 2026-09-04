// Симуляция цены — раздел 3.2 спеки (Geometric Brownian Motion).
//
// dS = S * (μ*dt + σ*sqrt(dt)*Z) + J   →  реализовано через exp() (раздел
// 3.2 псевдокод), что гарантирует S > 0 математически. Дополнительный
// clamp() в simulateTick — защитный барьер на edge case раздела 26
// («экстремальный шок уводит цену в отрицательную область»), а не расчёт
// на то, что формула сама уйдёт в минус.
import type { Asset, MarketRegime } from "@/engine/entities/types";

/** Box-Muller — стандартное нормальное распределение N(mean, stdDev). */
export function randomNormal(mean: number, stdDev: number, rng: () => number): number {
  // rng() может вернуть 0 — избегаем log(0).
  let u1 = 0;
  while (u1 === 0) u1 = rng();
  const u2 = rng();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdDev * z0;
}

// Базовый объём одного тика движка — условные «лоты». Абсолютная величина
// значения не имеет: объём в игре нужен как ОТНОСИТЕЛЬНАЯ характеристика
// («здесь торговали активнее, чем там»), поэтому важна только форма
// распределения, а не единицы измерения.
export const BASE_TICK_VOLUME = 40;

/**
 * Объём, наторгованный за один тик. Складывается из двух частей: постоянного
 * фона (рынок торгуется всегда) и всплеска, пропорционального движению цены —
 * так работает и настоящий рынок: резкое движение это всегда всплеск объёма,
 * а не тихий дрейф. Плюс случайный множитель, иначе гистограмма объёма
 * выглядела бы копией графика цены.
 */
export function tickVolume(returnPct: number, rng: () => number): number {
  const move = Math.abs(returnPct);
  const spike = 1 + move * 400;
  return BASE_TICK_VOLUME * spike * (0.4 + rng() * 1.2);
}

/** Округление к шагу цены актива (tickSize). */
export function roundToTickSize(price: number, tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return price;
  return Math.round(price / tickSize) * tickSize;
}

export interface SimulateTickParams {
  asset: Asset;
  currentPrice: number;
  dtYears: number;
  regime: MarketRegime;
  activeVolMultiplier: number;
  correlatedZ: number; // предгенерированный (коррелированный, если применимо) шок
}

/** Один шаг цены по формуле 3.2. Всегда > 0 (лог-нормальная модель + clamp). */
export function simulateTick(params: SimulateTickParams): number {
  const { asset, currentPrice, dtYears, regime, activeVolMultiplier, correlatedZ } = params;
  const mu = asset.baseDrift * regime.driftModifier;
  const sigma = asset.baseVolatility * activeVolMultiplier * regime.volModifier;
  const drift = mu * dtYears;
  const diffusion = sigma * Math.sqrt(dtYears) * correlatedZ;
  const newPrice = currentPrice * Math.exp(drift - 0.5 * sigma ** 2 * dtYears + diffusion);
  // Защитный барьер (раздел 26): формула математически не даёт ≤0, но
  // clamp — явная страховка, а не расчёт на это свойство формулы.
  const clamped = Math.max(asset.tickSize, newPrice);
  return roundToTickSize(clamped, asset.tickSize);
}
