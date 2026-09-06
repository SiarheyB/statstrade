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
import { Prisma } from "@prisma/client";

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

  // Доля идей, которые заработали ХОТЬ КОМУ-ТО деньги при копировании.
  // Считаем по GameSignalSettlement (см. copytrading.ts payLeaderFee): запись
  // появляется только когда скопированная сделка закрыта в плюс и комиссия
  // реально начислена — то есть это не мнение автора о себе, а факт с рынка.
  // Не «средняя прибыль» и не «сколько заработал я» — насколько ЧАСТО его
  // сигналы вообще срабатывали хоть у кого-то.
  const ids = rows.map((r) => r.id).filter((id) => id !== playerId);
  const signalsWithOutcome =
    ids.length === 0
      ? []
      : await prisma.gameSignal.findMany({
          where: { authorId: { in: ids } },
          select: {
            authorId: true,
            settlements: { where: { paidProfit: { gt: 0 } }, select: { id: true }, take: 1 },
          },
        });
  const successByAuthor = new Map<string, { total: number; won: number }>();
  for (const signal of signalsWithOutcome) {
    const stat = successByAuthor.get(signal.authorId) ?? { total: 0, won: 0 };
    stat.total++;
    if (signal.settlements.length > 0) stat.won++;
    successByAuthor.set(signal.authorId, stat);
  }

  return rows
    .filter((row) => row.id !== playerId)
    .map((row) => {
      const stat = successByAuthor.get(row.id);
      return {
        id: row.id,
        nickname: row.nickname,
        rankKey: row.rankKey,
        contractsPassed: row.contractsPassed,
        prestige: row.prestige,
        activeStyle: row.activeStyle,
        feePct: row.signalFeePct,
        followers: row._count.ledSubscriptions,
        signals: row._count.signals,
        // null — сигналов ещё не было, и завышать/занижать нечего.
        successRatePct: stat && stat.total > 0 ? Math.round((stat.won / stat.total) * 100) : null,
        subscribed: subscribed.has(row.id),
        auto: subscribed.get(row.id) ?? false,
      };
    });
}

/**
 * Комиссия ведущему с прибыльной скопированной сделки.
 *
 * Деньги — в очередь на получение, тем же каналом, что проценты по займам и
 * призы: игровой баланс живёт в браузере, сервер ведёт обязательства.
 *
 * КЛИЕНТУ ЗДЕСЬ НЕ ВЕРЯТ НИ В ЧЁМ, КРОМЕ РАЗМЕРА ПРИБЫЛИ. Раньше он присылал
 * и получателя, и ставку комиссии, и сумму — сервер начислял, не проверяя ни
 * подписки, ни сделки, ни повторов. Цикл таких запросов печатал деньги на
 * любой аккаунт, а деньги эти уходили в общий мир: рейтинги, капиталы фондов,
 * витрины. Теперь:
 *
 *  - получатель берётся из АВТОРА сигнала, а не из запроса;
 *  - ставка — из записи подписки, которую подписчик не редактирует;
 *  - без активной подписки не платят вовсе;
 *  - каждая пара «сигнал + подписчик» копит оплаченное, поэтому повтор
 *    запроса ничего не добавляет, а частичные закрытия складываются;
 *  - потолок прибыли по одному сигналу — эквити подписчика: заработать с
 *    одной сделки больше собственного счёта нельзя, а «миллиард» с копеечной
 *    позиции именно так и выглядел.
 */
/**
 * Читает остаток потолка, считает и списывает — целиком под SERIALIZABLE.
 *
 * ГОНКА, НАЙДЕННАЯ ПРИ НАГРУЗОЧНОЙ ПРОВЕРКЕ. Раньше «сколько ещё можно
 * заплатить» читалось отдельным запросом, а решение принималось в коде —
 * между чтением и записью помещался ЛЮБОЙ параллельный вызов. Пять закрытий
 * одной позиции подряд видели один и тот же остаток и списывали впятеро
 * больше потолка.
 *
 * SERIALIZABLE не блокирует конкурентов — она проигрывает второй транзакции,
 * которая пересеклась с первой, серию (Postgres P2034) и заставляет её
 * начать заново; тогда она читает уже обновлённый остаток. Один повтор
 * покрывает почти всё: гонка на пару параллельных запросов длится
 * миллисекунды.
 */
async function settleWithCap(
  signalId: string,
  followerId: string,
  authorId: string,
  profit: number,
  cap: number,
  feePct: number,
): Promise<number> {
  const attempt = () =>
    prisma.$transaction(
      async (tx) => {
        const settlement = await tx.gameSignalSettlement.findUnique({
          where: { signalId_followerId: { signalId, followerId } },
          select: { paidProfit: true },
        });
        const allowed = Math.min(profit, Math.max(0, cap - (settlement?.paidProfit ?? 0)));
        if (!(allowed > 0)) return 0;
        const fee = allowed * (feePct / 100);
        await tx.gameSignalSettlement.upsert({
          where: { signalId_followerId: { signalId, followerId } },
          create: { signalId, followerId, paidProfit: allowed, paidFee: fee },
          update: { paidProfit: { increment: allowed }, paidFee: { increment: fee } },
        });
        await tx.gamePlayer.update({ where: { id: authorId }, data: { pendingPayout: { increment: fee } } });
        return fee;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

  try {
    return await attempt();
  } catch (err) {
    // P2034 — ровно та гонка, ради которой это всё затевалось: вторая
    // попытка читает уже посвежевший остаток и в норме проходит.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
      try {
        return await attempt();
      } catch {
        return 0;
      }
    }
    throw err;
  }
}

export async function payLeaderFee(
  followerId: string,
  signalId: string,
  profit: number,
): Promise<number> {
  if (!(profit > 0)) return 0;

  const signal = await prisma.gameSignal.findUnique({
    where: { id: signalId },
    select: { id: true, authorId: true },
  });
  if (!signal || signal.authorId === followerId) return 0;

  const [subscription, follower] = await Promise.all([
    prisma.gameSubscription.findUnique({
      where: { leaderId_followerId: { leaderId: signal.authorId, followerId } },
      select: { feePct: true },
    }),
    prisma.gamePlayer.findUnique({ where: { id: followerId }, select: { equity: true } }),
  ]);
  if (!subscription || !(subscription.feePct > 0)) return 0;

  const cap = Math.max(0, follower?.equity ?? 0);
  const fee = await settleWithCap(signalId, followerId, signal.authorId, profit, cap, subscription.feePct);
  return fee;
}
