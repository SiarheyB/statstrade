/**
 * alerts.ts — «цена подошла к уровню»: пороги и решение о срабатывании.
 *
 * Вся арифметика здесь чистая (без БД и сети) — её же гоняет крон
 * /api/cron/level-alerts раз в минуту и она же покрыта тестами.
 */

/**
 * Порог в долях ATR, а не в процентах от цены.
 *
 * Страница «Рекомендации» целиком меряет расстояния в ATR — среднем дневном
 * ходе инструмента. 0.25×ATR одинаково осмысленно и для биткоина, и для
 * копеечной монеты: это «четверть обычного дневного пути». Один и тот же
 * процент для них означал бы совершенно разное — по BTC уведомление приходило
 * бы за сутки до подхода, по волатильной монете не приходило бы вовсе.
 */
export const DEFAULT_THRESHOLD_ATR = 0.25;
export const MIN_THRESHOLD_ATR = 0.05;
export const MAX_THRESHOLD_ATR = 1;

/** Ползунок в карточке ходит по этим значениям — шаг мельче незаметен. */
export const THRESHOLD_STEPS = [0.1, 0.15, 0.25, 0.4, 0.6, 1] as const;

export function clampThreshold(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_THRESHOLD_ATR;
  return Math.min(MAX_THRESHOLD_ATR, Math.max(MIN_THRESHOLD_ATR, v));
}

/**
 * Во сколько раз дальше порога должна уйти цена, чтобы уже сработавшее
 * уведомление снова «зарядилось».
 *
 * Без этого возврата подписка была бы одноразовой: человек один раз получил
 * уведомление, цена от уровня отошла, назавтра подошла снова — и тишина, хотя
 * подписка на вид активна. А без запаса (коэффициент 1) уведомления сыпались
 * бы пачкой всё время, пока цена дрожит ровно на границе порога. Двойное
 * расстояние — обычный гистерезис: чтобы зарядиться заново, цене нужно уйти
 * заметно дальше, чем нужно было, чтобы сработать.
 */
export const REARM_FACTOR = 2;

/** Расстояние от цены до уровня в долях ATR. */
export function distanceInAtr(price: number, levelPrice: number, atr: number): number {
  // ATR нулевой или битый — расстояние в ATR не определено. Возвращаем
  // бесконечность: такая подписка не сработает никогда, что честнее, чем
  // деление на ноль и срабатывание на каждом тике.
  if (!Number.isFinite(atr) || atr <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(price - levelPrice) / atr;
}

export type AlertDecision = "fire" | "rearm" | "none";

/**
 * Что делать с подпиской при текущей цене.
 *
 *  fire  — цена вошла в зону уровня, уведомление нужно отправить;
 *  rearm — цена ушла достаточно далеко, сработавшую подписку можно зарядить снова;
 *  none  — ничего не изменилось.
 */
export function decide(opts: {
  price: number;
  levelPrice: number;
  atr: number;
  thresholdAtr: number;
  /** Уже срабатывала? */
  triggered: boolean;
}): AlertDecision {
  const dist = distanceInAtr(opts.price, opts.levelPrice, opts.atr);
  if (!Number.isFinite(dist)) return "none";
  const threshold = clampThreshold(opts.thresholdAtr);
  if (opts.triggered) {
    return dist > threshold * REARM_FACTOR ? "rearm" : "none";
  }
  return dist <= threshold ? "fire" : "none";
}

function decimalsOf(v: number): number {
  return (String(v).split(".")[1] ?? "").length;
}

/**
 * Цену в тексте уведомления печатаем с числом знаков, достаточным И для неё
 * самой, И для уровня: у монеты за 0.00004321 округление до двух знаков
 * превратило бы обе цены в «0.00», и уведомление стало бы бессмысленным.
 *
 * Знаки берём по МАКСИМУМУ из двух чисел, а не по одному уровню: уровень
 * часто круглее текущей цены (0.00004 против 0.00004321), и равнение на него
 * съело бы именно ту разницу, ради которой уведомление и пришло.
 */
export function formatPrice(value: number, reference: number): string {
  // Инструмент дороже единицы — два знака и всё: у BTC за 112 345 доли цента
  // это чистый шум (тот же приём, что у fmtAtrPrice в карточке сетапа).
  if (Math.abs(reference) >= 1) return value.toFixed(2);
  const decimals = Math.max(decimalsOf(value), decimalsOf(reference), 2);
  return value.toFixed(Math.min(decimals, 8));
}

/** Текст push-уведомления: заголовок и тело. */
export function alertText(opts: {
  symbol: string;
  price: number;
  levelPrice: number;
  direction: string;
}): { title: string; body: string } {
  const price = formatPrice(opts.price, opts.levelPrice);
  const level = formatPrice(opts.levelPrice, opts.levelPrice);
  const side = opts.direction === "short" ? "шорт" : "лонг";
  // Откуда подходим — это то, что человек хочет понять, не открывая график:
  // подход сверху и снизу к одному и тому же уровню означают разные сценарии.
  const from = opts.price > opts.levelPrice ? "сверху" : "снизу";
  return {
    title: `${opts.symbol}: цена у уровня ${level}`,
    body: `Сейчас ${price} — подходим ${from}. Сетап на ${side}.`,
  };
}
