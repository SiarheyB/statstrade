// Новостной поток — раздел 3.5 спеки. До Фазы 3 шаг 2 главного тика был
// заглушкой: цена ходила чистым GBM, и «почему рынок дёрнулся» ответа не
// имело. Новость даёт мгновенный скачок цены и повышенную волатильность на
// какое-то время после — то есть ровно то, из-за чего в реальной торговле
// стоят стопы.
//
// Частота, сила и длительность разнесены по важности (impact): мелких
// новостей много и они почти не двигают цену, чёрные лебеди редки, но
// сносят рынок целиком.
import newsTemplatesData from "@/data/newsTemplates.json";
import type { Asset, NewsEvent, NewsImpact, NewsTemplate } from "@/engine/entities/types";

export const NEWS_TEMPLATES = newsTemplatesData as NewsTemplate[];

// Ожидаемое число новостей на игровой день по всему рынку. 1.5 — чтобы на
// day-стиле (60x, игровой день ≈ 24 минуты реального времени) новость
// приходила несколько раз за сессию, а не раз в час.
export const NEWS_PER_GAME_DAY = 1.5;

// Веса важности. Чёрный лебедь именно ЧЁРНЫЙ: 0.001 при ~550 новостях в
// игровой год — примерно одно событие в четыре года. Первая прикидка (0.015)
// давала обвал раз в 50 игровых дней, и рынок не успевал восстанавливаться:
// все девять шаблонов уровня black_swan — катастрофы (положительных чёрных
// лебедей не бывает), поэтому их частота напрямую превращается в
// долгосрочный нисходящий снос. Замерено прогоном: со старым весом новости
// уносили цену в 0.001 от начальной за 3 игровых года.
export const IMPACT_WEIGHTS: Record<NewsImpact, number> = {
  low: 0.72,
  medium: 0.235,
  high: 0.044,
  black_swan: 0.001,
};

// Во сколько раз новость раздувает σ затронутых активов и на сколько свечей.
// Значения намеренно скромные: множитель новости УМНОЖАЕТСЯ на множитель
// режима (кризис ×2.5), а в формуле 3.2 есть член −0.5σ²t — при σ, задранной
// вчетверо, он один съедает десятки процентов цены за игровой месяц, и рынок
// осыпается без единой «плохой» новости. Поймано на живом прогоне: NXTK
// улетел со 100 до 16 за 250 игровых дней.
export const IMPACT_VOL_MULTIPLIER: Record<NewsImpact, number> = {
  low: 1.15,
  medium: 1.4,
  high: 1.9,
  black_swan: 2.5,
};
export const IMPACT_VOL_CANDLES: Record<NewsImpact, number> = {
  low: 3,
  medium: 8,
  high: 20,
  black_swan: 50,
};

export const GLOBAL_TARGET = "*";

/** Сколько новостей хранит лента. Дальше — обрезаем, это UI-история. */
export const MAX_NEWS_FEED = 50;

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

export function pickImpact(rng: () => number): NewsImpact {
  const roll = rng();
  let acc = 0;
  for (const [impact, weight] of Object.entries(IMPACT_WEIGHTS) as [NewsImpact, number][]) {
    acc += weight;
    if (roll < acc) return impact;
  }
  return "low";
}

/**
 * Направление шока выбирается ПЕРВЫМ, до шаблона, и по умолчанию честной
 * монетой (со смещением по режиму). Это не косметика, а вопрос баланса: в
 * каталоге негативных шаблонов вдвое больше позитивных (крахов и скандалов
 * придумывать веселее), и если сначала брать случайный шаблон, а знак
 * выводить из его полярности, новостной поток сам по себе становится
 * мощным нисходящим сносом — на прогоне рынок падал на 80% за игровой год
 * безо всякого кризиса. Сначала монета, потом шаблон под неё.
 */
export function pickDirection(driftModifier: number, rng: () => number): 1 | -1 {
  const bias = Math.max(-0.25, Math.min(0.25, driftModifier * 0.08));
  return rng() < 0.5 + bias ? 1 : -1;
}

/**
 * Шаблон нужной важности и НЕ противоречащий выбранному направлению:
 * «отчиталась выше ожиданий» не может уронить бумагу, поэтому под минус
 * берутся только negative и mixed, под плюс — positive и mixed.
 */
export function pickTemplate(impact: NewsImpact, direction: 1 | -1, rng: () => number): NewsTemplate | null {
  const wanted = direction === 1 ? "positive" : "negative";
  const pool = NEWS_TEMPLATES.filter((t) => t.impact === impact && (t.polarity === wanted || t.polarity === "mixed"));
  // Пустой пул возможен только если каталог поправят так, что у важности не
  // останется ни одного шаблона нужного знака — тогда лучше выдать любую
  // новость этой важности, чем промолчать.
  const fallback = NEWS_TEMPLATES.filter((t) => t.impact === impact);
  const candidates = pool.length > 0 ? pool : fallback;
  return candidates.length > 0 ? pick(candidates, rng) : null;
}

// Шаблоны новостей написаны по-русски (см. newsTemplates.json), поэтому и
// подстановка сектора должна быть русской: заголовок вида «Введены квоты,
// затронувшие real_estate» выглядел бы как недоделанный плейсхолдер. Это
// НЕ i18n-словарь — движок ничего не знает про локали, здесь просто данные
// того же языка, что и шаблоны.
export const SECTOR_LABELS: Record<string, string> = {
  tech: "технологии",
  energy: "энергетику",
  healthcare: "здравоохранение",
  financials: "финансовый сектор",
  consumer: "потребительский сектор",
  industrials: "промышленность",
  real_estate: "недвижимость",
  telecom: "телеком",
  materials: "сырьевой сектор",
  utilities: "коммунальный сектор",
};

export function sectorLabel(sector: string): string {
  return SECTOR_LABELS[sector] ?? sector.replace(/_/g, " ");
}

/** Собирает конкретное событие из шаблона: цель, заголовок, сила шока. */
export function generateNews(
  assets: Asset[],
  driftModifier: number,
  gameElapsedMs: number,
  candleIntervalMs: number,
  rng: () => number,
): NewsEvent | null {
  if (assets.length === 0) return null;
  const impact = pickImpact(rng);
  const direction = pickDirection(driftModifier, rng);
  const template = pickTemplate(impact, direction, rng);
  if (!template) return null;
  // Полярность шаблона всё равно главнее направления: в редком fallback-
  // случае (см. pickTemplate) она не даст выпустить «повысили прогноз» с
  // минусом.
  const sign = template.polarity === "positive" ? 1 : template.polarity === "negative" ? -1 : direction;

  const asset = pick(assets, rng);
  const sectors = Array.from(new Set(assets.map((a) => a.sector).filter((s): s is string => !!s)));
  // Шаблон про сектор при пустом списке секторов (например, портфель из
  // одних облигаций) выродился бы в заголовок с дыркой — отдаём его как
  // событие по одному активу, а не пропускаем новость вовсе.
  const sector = template.targetType === "sector" && sectors.length > 0 ? pick(sectors, rng) : undefined;

  let affectedAssets: string[];
  let affectedSectors: string[] | undefined;
  let subject: string;
  if (template.targetType === "global") {
    affectedAssets = [GLOBAL_TARGET];
    subject = "";
  } else if (sector) {
    affectedSectors = [sector];
    affectedAssets = assets.filter((a) => a.sector === sector).map((a) => a.id);
    subject = sectorLabel(sector);
  } else {
    affectedAssets = [asset.id];
    subject = asset.name;
  }

  const headline = template.template
    .replace("{asset}", asset.name)
    .replace("{sector}", sector ? sectorLabel(sector) : asset.sector ? sectorLabel(asset.sector) : asset.name)
    .replace("{assetClass}", asset.assetClass);

  const [lo, hi] = template.shockRange;
  const magnitude = lo + rng() * (hi - lo);
  const durationCandles = IMPACT_VOL_CANDLES[impact];

  return {
    id: `${template.id}-${Math.floor(gameElapsedMs)}-${Math.floor(rng() * 1e6)}`,
    timestamp: gameElapsedMs,
    headline,
    affectedAssets,
    affectedSectors,
    impact,
    priceShockPct: magnitude * sign,
    volatilityMultiplier: IMPACT_VOL_MULTIPLIER[impact],
    volatilityDurationCandles: durationCandles,
    expiresAt: gameElapsedMs + durationCandles * candleIntervalMs,
    templateId: template.id,
    subject: subject || undefined,
  };
}

/**
 * Пуассоновский розыгрыш: за интервал dtGameMs в среднем ожидается
 * NEWS_PER_GAME_DAY * дней новостей. Вероятность «хотя бы одна» =
 * 1-e^(-λ), но выдаём не больше ОДНОЙ новости за тик — на investing-
 * ускорении (трое игровых суток за тик) иначе прилетало бы по 4-5 событий
 * разом, и лента превращалась бы в мусор.
 */
export function maybeGenerateNews(
  dtGameMs: number,
  assets: Asset[],
  driftModifier: number,
  gameElapsedMs: number,
  candleIntervalMs: number,
  rng: () => number,
): NewsEvent | null {
  const days = dtGameMs / (24 * 60 * 60 * 1000);
  if (!(days > 0)) return null;
  const lambda = NEWS_PER_GAME_DAY * days;
  const probability = 1 - Math.exp(-lambda);
  if (rng() >= probability) return null;
  return generateNews(assets, driftModifier, gameElapsedMs, candleIntervalMs, rng);
}

export function newsAffectsAsset(news: NewsEvent, assetId: string): boolean {
  return news.affectedAssets.includes(GLOBAL_TARGET) || news.affectedAssets.includes(assetId);
}

/**
 * Множитель цены от новости. НЕ (1 + shock) для обоих знаков: пара «+5% и
 * −5%» так не возвращает цену на место (1.05 * 0.95 = 0.9975), и на тысяче
 * новостей за игровой год этот перекос сам по себе съедал рынок в ноль —
 * поймано прогоном на 3 игровых года: средняя цена падала со 100 до нуля
 * при формально симметричном потоке новостей.
 *
 * Симметрично в логарифмах: рост — умножение на (1+x), падение — деление на
 * (1+x). Тогда любые взаимно обратные новости компенсируют друг друга
 * точно, и «дрейф вниз» может появиться только из режима рынка, а не из
 * арифметики.
 */
export function shockFactor(priceShockPct: number): number {
  return priceShockPct >= 0 ? 1 + priceShockPct : 1 / (1 - priceShockPct);
}

/**
 * Мгновенный скачок цены при выходе новости (раздел 3.5). Возвращает НОВЫЙ
 * объект цен — состояние в сторе иммутабельно.
 */
export function applyNewsShock(prices: Record<string, number>, news: NewsEvent): Record<string, number> {
  const factor = shockFactor(news.priceShockPct);
  const next = { ...prices };
  for (const [assetId, price] of Object.entries(prices)) {
    if (!newsAffectsAsset(news, assetId)) continue;
    next[assetId] = Math.max(0, price * factor);
  }
  return next;
}

/**
 * Множитель волатильности по активам от ещё не истёкших новостей. Берём
 * МАКСИМУМ, а не произведение: две новости подряд по одной бумаге не должны
 * перемножаться в σ×4 — это уводит цену в неправдоподобные скачки, а
 * «сильнейшая новость задаёт режим» ближе к тому, как ведёт себя рынок.
 */
export function newsVolMultipliers(active: NewsEvent[], gameElapsedMs: number, assetIds: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const id of assetIds) result[id] = 1;
  for (const news of active) {
    if (news.expiresAt <= gameElapsedMs) continue;
    for (const id of assetIds) {
      if (!newsAffectsAsset(news, id)) continue;
      result[id] = Math.max(result[id], news.volatilityMultiplier);
    }
  }
  return result;
}

export function pruneExpiredNews(active: NewsEvent[], gameElapsedMs: number): NewsEvent[] {
  return active.filter((n) => n.expiresAt > gameElapsedMs);
}
