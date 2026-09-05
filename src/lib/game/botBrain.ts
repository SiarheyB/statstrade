// Решения бота: во что войти, что закрыть и почему.
//
// Раньше счёт бота двигался «в среднем по рынку»: красивое число, за которым
// не стоит ничего. Бот не мог ни ошибиться в конкретной бумаге, ни пересидеть
// падение, ни выйти в кэш перед новостью — а значит, и рейтинг из таких
// счетов ничего не значил.
//
// Теперь у бота есть деньги и позиции, а решение принимается двумя путями:
//
//   1) ВСТРОЕННАЯ ЛОГИКА — дешёвая, работает всегда и не зависит от сети.
//      Стиль задаёт, за чем бот охотится (скальпер ловит импульс, инвестор
//      покупает просевшее), «интеллект» — насколько часто он оказывается
//      прав, «стремление» — какую долю счёта ставит.
//   2) МОДЕЛЬ — когда бот думает по-настоящему: видит котировки, новости и
//      свои позиции и отвечает решением со своими словами. Как часто это
//      происходит, задаёт «глубина ИИ» в процентах.
//
// Разделение не косметическое: запрос к модели стоит денег и времени, и
// гонять его на каждом такте каждого бота — верный способ разорить владельца
// игры. Проценты позволяют держать умными тех, кто на виду, а массовке
// оставить встроенную логику.

/** Что бот решил сделать на этом такте. */
export type BotDecision =
  | { action: "hold"; reason: string }
  | { action: "open"; assetId: string; side: "long" | "short"; sizePct: number; reason: string }
  | { action: "close"; positionId: string; reason: string };

export interface BotSettings {
  /** Мастерство 0..1: доля решений, которые оказываются верными. */
  skill: number;
  /** Стремление 0..1+: какую долю счёта бот готов поставить в одну идею. */
  risk: number;
  /** Насколько глубоко думает моделью, %. 0 — только встроенная логика. */
  aiPct: number;
  style: string;
}

export interface BotPositionView {
  id: string;
  assetId: string;
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  openedAt: number;
}

export interface QuoteView {
  price: number;
  dayChangePct: number;
}

/** Сколько позиций бот держит одновременно. Больше — это уже не идеи, а каша. */
export const MAX_POSITIONS = 4;
/** Доля счёта в одной позиции при стремлении 1. */
export const BASE_POSITION_SHARE = 0.25;
/** Убыток по позиции, после которого бот выходит без раздумий. */
export const STOP_LOSS_PCT = 8;
/** Прибыль, на которой бот фиксирует. */
export const TAKE_PROFIT_PCT = 12;
/** Сколько бот держит позицию максимум, часов — по стилям. */
export const MAX_HOLD_HOURS: Record<string, number> = {
  scalping: 4,
  day: 24,
  swing: 24 * 7,
  investing: 24 * 90,
};

/** Нереализованный результат позиции в процентах. */
export function positionPnlPct(position: BotPositionView, price: number): number {
  const move = ((price - position.entryPrice) / position.entryPrice) * 100;
  return position.side === "long" ? move : -move;
}

/** Стоимость позиции для расчёта эквити. */
export function positionValue(position: BotPositionView, price: number): number {
  // Лонг стоит столько, сколько за него дают. Шорт денег не занимает: у него
  // считается только результат, а выручка от продажи уже лежит в кэше.
  return position.side === "long"
    ? position.qty * price
    : position.qty * (position.entryPrice - price);
}

/** Эквити бота: деньги плюс всё, что стоят его позиции. */
export function botEquity(cash: number, positions: BotPositionView[], quotes: Record<string, QuoteView>): number {
  return positions.reduce((sum, position) => {
    const price = quotes[position.assetId]?.price;
    return price ? sum + positionValue(position, price) : sum;
  }, cash);
}

/**
 * Решение встроенной логики.
 *
 * Сначала выход: позиция, по которой сработал стоп, тейк или истёк срок
 * стиля, закрывается раньше любых новых идей — иначе бот набирает бумаги и
 * никогда их не отпускает. Потом вход: направление задаёт стиль, а «интеллект»
 * решает, угадал бот или пошёл против движения.
 */
export function decideByRules(
  settings: BotSettings,
  positions: BotPositionView[],
  quotes: Record<string, QuoteView>,
  watched: string[],
  luck: number,
  now: number,
): BotDecision {
  const maxHold = (MAX_HOLD_HOURS[settings.style] ?? 24) * 60 * 60 * 1000;
  for (const position of positions) {
    const price = quotes[position.assetId]?.price;
    if (!price) continue;
    const pnl = positionPnlPct(position, price);
    if (pnl <= -STOP_LOSS_PCT) return { action: "close", positionId: position.id, reason: "стоп" };
    if (pnl >= TAKE_PROFIT_PCT) return { action: "close", positionId: position.id, reason: "фиксация прибыли" };
    if (now - position.openedAt > maxHold) return { action: "close", positionId: position.id, reason: "идея не сработала за отведённое время" };
  }

  if (positions.length >= MAX_POSITIONS) return { action: "hold", reason: "позиций уже достаточно" };

  const free = watched.filter((id) => !positions.some((p) => p.assetId === id) && quotes[id]);
  if (free.length === 0) return { action: "hold", reason: "смотреть не на что" };

  // Кого брать: самое подвижное за день — там, где вообще что-то происходит.
  const target = free.reduce((best, id) =>
    Math.abs(quotes[id].dayChangePct) > Math.abs(quotes[best].dayChangePct) ? id : best,
  );
  const change = quotes[target].dayChangePct;
  if (Math.abs(change) < 0.15) return { action: "hold", reason: "рынок стоит" };

  // Скальпер и дейтрейдер идут ЗА движением, свинг и инвестор — против:
  // это не характер, а разные горизонты, на которых работает разное.
  const followsMomentum = settings.style === "scalping" || settings.style === "day";
  const natural: "long" | "short" = followsMomentum ? (change > 0 ? "long" : "short") : change > 0 ? "short" : "long";
  // Мастерство решает, встал ли бот в правильную сторону. Слабый бот
  // регулярно делает ровно наоборот — и его счёт тает даже на растущем рынке.
  const side: "long" | "short" = luck < settings.skill ? natural : natural === "long" ? "short" : "long";
  const sizePct = Math.min(60, Math.max(5, BASE_POSITION_SHARE * settings.risk * 100));
  return {
    action: "open",
    assetId: target,
    side,
    sizePct,
    reason: followsMomentum ? "иду за движением дня" : "жду возврата к среднему",
  };
}

/** Разобрать ответ модели в решение. Модель врёт — проверяем каждое поле. */
export function parseDecision(
  raw: string,
  positions: BotPositionView[],
  bySymbol: Record<string, string>,
): BotDecision | null {
  // Модель любит обрамлять JSON текстом и ```-заборами: берём первый объект.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let data: unknown;
  try {
    data = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const object = data as Record<string, unknown>;
  const reason = typeof object.reason === "string" ? object.reason.slice(0, 200) : "";
  const action = typeof object.action === "string" ? object.action.toLowerCase() : "";

  if (action === "close") {
    const symbol = typeof object.symbol === "string" ? object.symbol.toUpperCase() : "";
    const assetId = bySymbol[symbol];
    const position = positions.find((p) => p.assetId === assetId);
    if (!position) return null;
    return { action: "close", positionId: position.id, reason: reason || "закрываю" };
  }

  if (action === "open" || action === "buy" || action === "sell") {
    const symbol = typeof object.symbol === "string" ? object.symbol.toUpperCase() : "";
    const assetId = bySymbol[symbol];
    if (!assetId) return null;
    // Сторона берётся из поля, а для buy/sell — из самого действия: модели
    // проще ответить одним словом, и запрещать ей это значит терять решения.
    const rawSide = typeof object.side === "string" ? object.side.toLowerCase() : action === "sell" ? "short" : "long";
    const side: "long" | "short" = rawSide === "short" || rawSide === "sell" ? "short" : "long";
    const size = typeof object.sizePct === "number" ? object.sizePct : 15;
    return {
      action: "open",
      assetId,
      side,
      sizePct: Math.min(60, Math.max(5, size)),
      reason: reason || "решение по анализу",
    };
  }

  return { action: "hold", reason: reason || "жду" };
}

/** Что показать модели: котировки, позиции и свежие заголовки. */
export function marketBrief(
  watched: string[],
  quotes: Record<string, QuoteView>,
  symbolOf: (assetId: string) => string,
  positions: BotPositionView[],
  news: { headline: string }[],
): string {
  const lines: string[] = [];
  const market = watched
    .map((id) => {
      const quote = quotes[id];
      if (!quote) return null;
      const sign = quote.dayChangePct >= 0 ? "+" : "";
      return `${symbolOf(id)} ${quote.price.toFixed(2)} (${sign}${quote.dayChangePct.toFixed(2)}% за день)`;
    })
    .filter(Boolean);
  if (market.length > 0) lines.push(`Инструменты: ${market.join("; ")}`);

  if (positions.length > 0) {
    const open = positions.map((position) => {
      const price = quotes[position.assetId]?.price ?? position.entryPrice;
      const pnl = positionPnlPct(position, price);
      const sign = pnl >= 0 ? "+" : "";
      return `${symbolOf(position.assetId)} ${position.side === "long" ? "лонг" : "шорт"} от ${position.entryPrice.toFixed(2)} (${sign}${pnl.toFixed(1)}%)`;
    });
    lines.push(`Открыто: ${open.join("; ")}`);
  } else {
    lines.push("Открытых позиций нет.");
  }

  if (news.length > 0) {
    lines.push(`Заголовки: ${news.slice(0, 5).map((item) => item.headline).join(" | ")}`);
  }
  return lines.join("\n");
}
