// Чат и рынок стратегий — то, что превращает таблицу рейтинга в мир.
//
// Три решения, которые стоит объяснить:
//
// 1. К сообщению можно приложить ИДЕЮ: инструмент, таймфрейм и свою
//    разметку. Это работает только потому, что рынок общий — собеседник
//    открывает ровно тот же график. Раньше, когда цены считал каждый
//    браузер, показывать друг другу уровни было бессмысленно.
// 2. Стратегия продаётся как КОПИЯ ПРАВИЛ, а не как подписка: купил —
//    настройки бота твои навсегда, второй раз ту же стратегию не продать.
//    Подписка потребовала бы регулярных списаний и учёта, а ценности игроку
//    добавила бы ноль.
// 3. Деньги автору приходят не «на сервер», а в очередь на получение
//    (pendingPayout) — тем же способом, что проценты по займам: игровой
//    баланс живёт в браузере, сервер ведёт только обязательства.
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/game/world";

export const MAX_MESSAGE_LENGTH = 400;
export const CHAT_PAGE_SIZE = 60;
// Не чаще одного сообщения в три секунды: чат на десяток игроков не нуждается
// в защите от флуда сложнее этой.
export const MESSAGE_COOLDOWN_MS = 3000;

export const MIN_STRATEGY_PRICE = 0;
export const MAX_STRATEGY_PRICE = 500_000;
export const MAX_STRATEGIES_PER_AUTHOR = 5;

export type ChatError = "empty" | "too_long" | "too_fast" | "unknown_channel" | "not_in_fund";
export type ChatResult<T> = { ok: true; value: T } | { ok: false; error: ChatError };

/** Каналы: общий зал, разговоры про инструменты и закрытый канал фонда. */
export function normalizeChannel(raw: string, fundId: string | null): string | null {
  if (raw === "general" || raw === "market") return raw;
  if (raw === "fund") return fundId ? `fund:${fundId}` : null;
  return null;
}

export interface ChatIdea {
  assetId?: string | null;
  tf?: string | null;
  drawings?: unknown;
}

export async function postMessage(
  playerId: string,
  nickname: string,
  channel: string,
  text: string,
  idea?: ChatIdea,
): Promise<ChatResult<{ id: string }>> {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length === 0) return { ok: false, error: "empty" };
  if (clean.length > MAX_MESSAGE_LENGTH) return { ok: false, error: "too_long" };

  const last = await prisma.gameChatMessage.findFirst({
    where: { playerId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last && Date.now() - last.createdAt.getTime() < MESSAGE_COOLDOWN_MS) {
    return { ok: false, error: "too_fast" };
  }

  const message = await prisma.gameChatMessage.create({
    data: {
      channel,
      playerId,
      text: clean,
      assetId: idea?.assetId ?? null,
      tf: idea?.tf ?? null,
      // Разметку храним строкой: она нужна целиком и только для показа —
      // запросов «по точкам» не бывает.
      drawings: idea?.drawings ? JSON.stringify(idea.drawings).slice(0, 8000) : null,
    },
  });
  if (idea?.assetId) {
    await recordEvent(playerId, "idea_shared", { nickname, assetId: idea.assetId });
  }
  return { ok: true, value: { id: message.id } };
}

export async function readMessages(channel: string, limit = CHAT_PAGE_SIZE) {
  const rows = await prisma.gameChatMessage.findMany({
    where: { channel },
    orderBy: { createdAt: "desc" },
    take: Math.min(CHAT_PAGE_SIZE, limit),
    select: {
      id: true,
      text: true,
      assetId: true,
      tf: true,
      drawings: true,
      createdAt: true,
      player: { select: { id: true, nickname: true, rankKey: true } },
    },
  });
  return rows.reverse().map((row) => ({
    id: row.id,
    text: row.text,
    assetId: row.assetId,
    tf: row.tf,
    drawings: row.drawings ? safeParse(row.drawings) : null,
    createdAt: row.createdAt.getTime(),
    author: row.player,
  }));
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Рынок стратегий ───────────────────────────────────────────────────────

export type StrategyError = "invalid_name" | "invalid_price" | "too_many" | "not_found" | "own_strategy" | "already_bought";
export type StrategyResult<T> = { ok: true; value: T } | { ok: false; error: StrategyError };

export interface StrategyConfig {
  strategy: string;
  assetId: string;
  riskPct: number;
  stopPct: number;
  takePct: number;
}

export async function publishStrategy(
  authorId: string,
  nickname: string,
  name: string,
  description: string,
  price: number,
  config: StrategyConfig,
): Promise<StrategyResult<{ id: string }>> {
  const cleanName = name.trim().replace(/\s+/g, " ");
  if (cleanName.length < 3 || cleanName.length > 40) return { ok: false, error: "invalid_name" };
  if (!(price >= MIN_STRATEGY_PRICE) || price > MAX_STRATEGY_PRICE) return { ok: false, error: "invalid_price" };
  const count = await prisma.gameStrategy.count({ where: { authorId } });
  if (count >= MAX_STRATEGIES_PER_AUTHOR) return { ok: false, error: "too_many" };

  const strategy = await prisma.gameStrategy.create({
    data: {
      authorId,
      name: cleanName,
      description: description.trim().slice(0, 200) || null,
      price,
      config: JSON.stringify(config),
    },
  });
  await recordEvent(authorId, "strategy_published", { nickname, strategy: cleanName, price });
  return { ok: true, value: { id: strategy.id } };
}

export async function buyStrategy(buyerId: string, nickname: string, strategyId: string): Promise<StrategyResult<{ price: number; config: StrategyConfig; name: string }>> {
  const strategy = await prisma.gameStrategy.findUnique({ where: { id: strategyId } });
  if (!strategy) return { ok: false, error: "not_found" };
  if (strategy.authorId === buyerId) return { ok: false, error: "own_strategy" };
  const existing = await prisma.gameStrategyPurchase.findUnique({
    where: { strategyId_buyerId: { strategyId, buyerId } },
  });
  if (existing) return { ok: false, error: "already_bought" };

  await prisma.$transaction([
    prisma.gameStrategyPurchase.create({ data: { strategyId, buyerId, price: strategy.price } }),
    prisma.gameStrategy.update({ where: { id: strategyId }, data: { purchases: { increment: 1 } } }),
    // Деньги автору — в очередь на получение, как проценты по займам.
    prisma.gamePlayer.update({ where: { id: strategy.authorId }, data: { pendingPayout: { increment: strategy.price } } }),
  ]);
  await recordEvent(buyerId, "strategy_bought", { nickname, strategy: strategy.name, price: strategy.price });

  return {
    ok: true,
    value: { price: strategy.price, name: strategy.name, config: safeParse(strategy.config) as StrategyConfig },
  };
}

export async function listStrategies(playerId: string) {
  const [rows, mine] = await Promise.all([
    prisma.gameStrategy.findMany({
      orderBy: [{ purchases: "desc" }, { createdAt: "desc" }],
      take: 30,
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        purchases: true,
        createdAt: true,
        config: true,
        author: { select: { id: true, nickname: true, rankKey: true, contractsPassed: true } },
      },
    }),
    prisma.gameStrategyPurchase.findMany({ where: { buyerId: playerId }, select: { strategyId: true } }),
  ]);
  const bought = new Set(mine.map((r) => r.strategyId));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    purchases: row.purchases,
    createdAt: row.createdAt.getTime(),
    config: safeParse(row.config) as StrategyConfig,
    author: row.author,
    owned: bought.has(row.id) || row.author.id === playerId,
  }));
}
