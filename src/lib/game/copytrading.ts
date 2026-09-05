// Копитрейдинг: подписка на сигналы игрока.
//
// Фонды и рынок стратегий дают участвовать в мире тем, кто торгует. Тем, кто
// торговать сам не хочет или пока не умеет, участвовать было нечем — а это
// половина пришедших.
//
// ПОЧЕМУ СИГНАЛЫ, А НЕ ЗЕРКАЛО. Сделки живут в браузере игрока, сервер их не
// видит: скопировать позицию один в один он физически не может. Но и не
// должен — слепое зеркало переносит на подписчика чужой размер риска, а
// размер обязан оставаться решением того, кто рискует своими деньгами.
// Поэтому ведущий публикует, ЧТО он открыл, а подписчик открывает то же сам,
// своим объёмом. Стоп и тейк — в процентах от входа: у подписчика своя цена
// входа, и абсолютные уровни ведущего ему не подходят.
//
// КОМИССИЯ берётся с ПРИБЫЛЬНОЙ скопированной сделки, как доля спонсора.
// Брать с убыточной значило бы наказывать человека дважды за то, что чужой
// сигнал не сработал.
import { prisma } from "@/lib/db";

/** Границы комиссии ведущего. */
export const MIN_SIGNAL_FEE_PCT = 5;
export const MAX_SIGNAL_FEE_PCT = 50;
/** Сколько последних сигналов отдаём подписчику. */
export const SIGNAL_PAGE_SIZE = 30;
/**
 * Сколько живёт сигнал, пока его ещё имеет смысл повторять.
 *
 * Час: цена ушла — повторять вход по чужой отметке уже не «копирование», а
 * покупка по другой цене под чужим предлогом.
 */
export const SIGNAL_FRESH_MS = 60 * 60 * 1000;

export type CopyError = "self" | "not_open" | "already" | "not_found" | "invalid_fee";
export type CopyResult<T> = { ok: true; value: T } | { ok: false; error: CopyError };

/** Открыть или закрыть себя для подписки. */
export async function setSignalsOpen(playerId: string, open: boolean, feePct: number): Promise<CopyResult<null>> {
  if (open && (!(feePct >= MIN_SIGNAL_FEE_PCT) || feePct > MAX_SIGNAL_FEE_PCT)) {
    return { ok: false, error: "invalid_fee" };
  }
  await prisma.gamePlayer.update({
    where: { id: playerId },
    data: { signalsOpen: open, ...(open ? { signalFeePct: feePct } : {}) },
  });
  return { ok: true, value: null };
}

/** Опубликовать сигнал. Публикует клиент ведущего, когда открывает позицию. */
export async function publishSignal(
  authorId: string,
  signal: { assetId: string; side: string; price: number; stopPct?: number | null; takePct?: number | null },
): Promise<void> {
  const author = await prisma.gamePlayer.findUnique({ where: { id: authorId }, select: { signalsOpen: true } });
  // Закрытый для подписки игрок сигналов не публикует: иначе его сделки
  // копились бы в базе без единого читателя.
  if (!author?.signalsOpen) return;
  await prisma.gameSignal.create({
    data: {
      authorId,
      assetId: signal.assetId,
      side: signal.side === "short" ? "short" : "long",
      price: signal.price,
      stopPct: signal.stopPct ?? null,
      takePct: signal.takePct ?? null,
    },
  });
}

export async function subscribe(followerId: string, leaderId: string, auto: boolean): Promise<CopyResult<{ feePct: number }>> {
  if (followerId === leaderId) return { ok: false, error: "self" };
  const leader = await prisma.gamePlayer.findUnique({
    where: { id: leaderId },
    select: { signalsOpen: true, signalFeePct: true },
  });
  if (!leader) return { ok: false, error: "not_found" };
  if (!leader.signalsOpen) return { ok: false, error: "not_open" };

  const existing = await prisma.gameSubscription.findUnique({
    where: { leaderId_followerId: { leaderId, followerId } },
  });
  if (existing) {
    // Повторная подписка — это переключение режима, а не ошибка: человек
    // нажал ту же кнопку, значит хочет поменять автоматику.
    await prisma.gameSubscription.update({ where: { id: existing.id }, data: { auto } });
    return { ok: true, value: { feePct: existing.feePct } };
  }

  await prisma.gameSubscription.create({
    data: { leaderId, followerId, feePct: leader.signalFeePct, auto },
  });
  return { ok: true, value: { feePct: leader.signalFeePct } };
}

export async function unsubscribe(followerId: string, leaderId: string): Promise<void> {
  await prisma.gameSubscription.deleteMany({ where: { leaderId, followerId } });
}

/** Свежие сигналы всех, на кого подписан игрок. */
export async function feedFor(followerId: string, now = Date.now()) {
  const subs = await prisma.gameSubscription.findMany({
    where: { followerId },
    select: { leaderId: true, feePct: true, auto: true },
  });
  if (subs.length === 0) return { subscriptions: [], signals: [] };

  const signals = await prisma.gameSignal.findMany({
    where: {
      authorId: { in: subs.map((s) => s.leaderId) },
      createdAt: { gte: new Date(now - SIGNAL_FRESH_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: SIGNAL_PAGE_SIZE,
    select: {
      id: true,
      assetId: true,
      side: true,
      price: true,
      stopPct: true,
      takePct: true,
      createdAt: true,
      author: { select: { id: true, nickname: true, rankKey: true } },
    },
  });

  const byLeader = new Map(subs.map((s) => [s.leaderId, s]));
  return {
    subscriptions: subs,
    signals: signals.map((signal) => ({
      id: signal.id,
      assetId: signal.assetId,
      side: signal.side,
      price: signal.price,
      stopPct: signal.stopPct,
      takePct: signal.takePct,
      createdAt: signal.createdAt.getTime(),
      author: signal.author,
      auto: byLeader.get(signal.author.id)?.auto ?? false,
      feePct: byLeader.get(signal.author.id)?.feePct ?? 0,
    })),
  };
}

/** Кто открыт для подписки: витрина ведущих. */
export async function leaders(playerId: string, limit = 20) {
  const [rows, mine] = await Promise.all([
    prisma.gamePlayer.findMany({
      where: { signalsOpen: true, isPublic: true },
      orderBy: [{ contractsPassed: "desc" }, { prestige: "desc" }],
      take: limit,
      select: {
        id: true,
        nickname: true,
        rankKey: true,
        contractsPassed: true,
        prestige: true,
        activeStyle: true,
        signalFeePct: true,
        _count: { select: { ledSubscriptions: true, signals: true } },
      },
    }),
    prisma.gameSubscription.findMany({ where: { followerId: playerId }, select: { leaderId: true, auto: true } }),
  ]);
  const subscribed = new Map(mine.map((row) => [row.leaderId, row.auto]));
  return rows
    .filter((row) => row.id !== playerId)
    .map((row) => ({
      id: row.id,
      nickname: row.nickname,
      rankKey: row.rankKey,
      contractsPassed: row.contractsPassed,
      prestige: row.prestige,
      activeStyle: row.activeStyle,
      feePct: row.signalFeePct,
      followers: row._count.ledSubscriptions,
      signals: row._count.signals,
      subscribed: subscribed.has(row.id),
      auto: subscribed.get(row.id) ?? false,
    }));
}

/**
 * Комиссия ведущему с прибыльной скопированной сделки.
 *
 * Деньги — в очередь на получение, тем же каналом, что проценты по займам и
 * призы: игровой баланс живёт в браузере, сервер ведёт обязательства.
 */
export async function payLeaderFee(leaderId: string, profit: number, feePct: number): Promise<number> {
  if (!(profit > 0) || !(feePct > 0)) return 0;
  const fee = profit * (feePct / 100);
  await prisma.gamePlayer.update({ where: { id: leaderId }, data: { pendingPayout: { increment: fee } } });
  return fee;
}
