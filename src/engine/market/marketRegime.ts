// Рыночные режимы — раздел 3.4 спеки. До Фазы 3 движок всегда считал цену в
// NEUTRAL_REGIME (модификаторы = 1), то есть рынок был вечно одинаковым: ни
// тренда, ни паники, ни затишья. Режим — это то, что делает партии
// непохожими друг на друга: один и тот же тикер в bull и в crisis ведёт себя
// принципиально по-разному, хотя формула цены (3.2) не меняется — меняются
// только μ и σ, которые в неё подставляются.
import type { MarketRegime, MarketRegimeType } from "@/engine/entities/types";

export interface RegimePreset {
  driftModifier: number; // множитель к годовому сносу μ всех активов
  volModifier: number; // множитель к годовой волатильности σ
  minDurationDays: number; // раньше этого срока режим не меняется
  maxDurationDays: number; // на этом сроке меняется гарантированно
}

// Значения подобраны так, чтобы каждый режим читался на графике за
// разумное игровое время и при этом не ломал экономику: bull — заметный, но
// не безрисковый рост, crisis — короткий и злой (в реальности кризисы тоже
// короче бычьих циклов), sideways — «скучный» рынок с зажатой волатильностью.
//
// Долгосрочный баланс: взвешенный по времени в режимах снос должен выходить
// в небольшой плюс — иначе рынок, на котором игрок «просто держит», обязан
// проигрывать, а buy&hold-стиль (Investing) становится ловушкой. Проверено
// прогоном на 3 игровых года по 15 сидам (см. историю правок): бычьих и
// боковых периодов больше, чем медвежьих, кризис короткий и редкий.
//
// Сроки заданы в ИГРОВЫХ днях, а игровой день теперь равен реальному. Взяты
// не биржевые (бычий рынок годами), а игровые: режим, который не меняется
// месяцами реального времени, для игрока просто не существует. Ориентир —
// увидеть смену обстановки за несколько заходов, а не за сезон.
//
// Длительности подобраны так, чтобы ВЗВЕШЕННЫЙ ПО ВРЕМЕНИ снос выходил в
// небольшой плюс: рынок большую часть времени растёт, и игрок, который
// просто держит бумагу, не должен гарантированно проигрывать. Первый подбор
// давал бычий рынок лишь 11% времени и повышенную волатильность 30% —
// средний множитель сноса выходил 0.14 при множителе волатильности 1.43, и
// любая бумага медленно сползала вниз (замерено: биткоин −77% за год с
// небольшим). Считать это глазами бесполезно — только прогоном.
export const REGIME_PRESETS: Record<MarketRegimeType, RegimePreset> = {
  bull: { driftModifier: 2.5, volModifier: 0.9, minDurationDays: 6, maxDurationDays: 22 },
  bear: { driftModifier: -1.2, volModifier: 1.35, minDurationDays: 5, maxDurationDays: 16 },
  sideways: { driftModifier: 0.5, volModifier: 0.75, minDurationDays: 5, maxDurationDays: 16 },
  high_volatility: { driftModifier: 0.5, volModifier: 2.0, minDurationDays: 2, maxDurationDays: 5 },
  crisis: { driftModifier: -3, volModifier: 2.5, minDurationDays: 1, maxDurationDays: 4 },
};

// Куда режим может перейти и с какими весами. Матрица НЕ симметрична и это
// намеренно: в кризис рынок сваливается из повышенной волатильности гораздо
// чаще, чем прямо из спокойного боковика, а выходит из кризиса обычно не
// сразу в рост, а в затяжной медвежий/боковой рынок.
export const REGIME_TRANSITIONS: Record<MarketRegimeType, [MarketRegimeType, number][]> = {
  bull: [["sideways", 0.5], ["bear", 0.3], ["high_volatility", 0.15], ["crisis", 0.05]],
  bear: [["sideways", 0.45], ["bull", 0.3], ["high_volatility", 0.17], ["crisis", 0.08]],
  sideways: [["bull", 0.45], ["bear", 0.35], ["high_volatility", 0.17], ["crisis", 0.03]],
  high_volatility: [["sideways", 0.35], ["bull", 0.3], ["bear", 0.28], ["crisis", 0.07]],
  crisis: [["bear", 0.5], ["sideways", 0.35], ["high_volatility", 0.15]],
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function makeRegime(type: MarketRegimeType, daysInRegime = 0): MarketRegime {
  const preset = REGIME_PRESETS[type];
  return { type, ...preset, daysInRegime };
}

/** Взвешенный выбор следующего режима. */
export function pickNextRegime(current: MarketRegimeType, rng: () => number): MarketRegimeType {
  const options = REGIME_TRANSITIONS[current];
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [type, weight] of options) {
    roll -= weight;
    if (roll <= 0) return type;
  }
  return options[options.length - 1][0];
}

/**
 * Вероятность смены режима за ОДИН игровой день. До minDurationDays — ноль,
 * после maxDurationDays — единица, между ними линейно нарастает. Так режим
 * живёт заявленный срок, но конкретная длительность каждый раз разная, и
 * игрок не может считать дни до разворота.
 */
export function switchProbabilityPerDay(regime: MarketRegime): number {
  const { daysInRegime, minDurationDays, maxDurationDays } = regime;
  if (daysInRegime < minDurationDays) return 0;
  if (daysInRegime >= maxDurationDays) return 1;
  const span = maxDurationDays - minDurationDays;
  if (span <= 0) return 1;
  return (daysInRegime - minDurationDays) / span;
}

/**
 * Продвигает режим на dtGameMs вперёд и, возможно, меняет его.
 *
 * Вероятность считается за ДЕНЬ, а тик может быть и короче, и длиннее дня
 * (у investing один тик — трое игровых суток), поэтому переводим её в
 * вероятность за прошедший интервал как 1-(1-p)^days: иначе на медленных
 * стилях режим не менялся бы почти никогда, а на быстрых менялся бы по
 * несколько раз за тик.
 */
export function updateMarketRegime(regime: MarketRegime, dtGameMs: number, rng: () => number): MarketRegime {
  const days = dtGameMs / MS_PER_DAY;
  if (!(days > 0)) return regime;
  const advanced: MarketRegime = { ...regime, daysInRegime: regime.daysInRegime + days };
  const pPerDay = switchProbabilityPerDay(advanced);
  if (pPerDay <= 0) return advanced;
  const pInterval = pPerDay >= 1 ? 1 : 1 - (1 - pPerDay) ** days;
  if (rng() >= pInterval) return advanced;
  return makeRegime(pickNextRegime(advanced.type, rng));
}
