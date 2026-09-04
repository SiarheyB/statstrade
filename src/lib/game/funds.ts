// Фонды — команды игроков с общим котлом.
//
// Зачем в игре про трейдинг вообще команда: одиночная кривая эквити никому,
// кроме владельца, не интересна, а фонд даёт то, ради чего в браузерные игры
// возвращаются — общий результат, за который стыдно или приятно. Плюс это
// естественная поздняя цель: сначала докажи себя испытаниями, потом собери
// вокруг себя людей.
//
// Механика денег та же, что у займов: сервер ведёт записи, движение по
// игровому балансу применяет клиент. Забрать из фонда можно не больше, чем
// внёс сам (плюс полученные выплаты) — иначе фонд превращался бы в кассу
// для вывода чужих взносов.
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/game/world";

export const FUND_CREATION_COST = 25_000;
export const FUND_MIN_PRESTIGE = 60;
export const MIN_FUND_DEPOSIT = 500;
export const MAX_FUND_FEE_PCT = 40;

export type FundError =
  | "not_enough_prestige"
  | "name_taken"
  | "invalid_name"
  | "already_in_fund"
  | "not_found"
  | "not_owner"
  | "owner_cannot_leave"
  | "invalid_amount"
  | "not_member"
  | "exceeds_share"
  | "insufficient_capital";

export type FundResult<T> = { ok: true; value: T } | { ok: false; error: FundError };

export function normalizeFundName(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length < 3 || value.length > 32) return null;
  if (!/^[\p{L}\p{N} .,'&_-]+$/u.test(value)) return null;
  return value;
}

export async function createFund(
  playerId: string,
  nickname: string,
  prestige: number,
  fundId: string | null,
  name: string,
  motto: string,
  feePct: number,
): Promise<FundResult<{ id: string; cost: number }>> {
  if (prestige < FUND_MIN_PRESTIGE) return { ok: false, error: "not_enough_prestige" };
  if (fundId) return { ok: false, error: "already_in_fund" };
  const cleanName = normalizeFundName(name);
  if (!cleanName) return { ok: false, error: "invalid_name" };
  const taken = await prisma.gameFund.findUnique({ where: { name: cleanName } });
  if (taken) return { ok: false, error: "name_taken" };

  const fund = await prisma.gameFund.create({
    data: {
      name: cleanName,
      motto: motto.trim().slice(0, 120) || null,
      ownerId: playerId,
      feePct: Math.max(0, Math.min(MAX_FUND_FEE_PCT, feePct)),
      capital: FUND_CREATION_COST,
      members: { connect: { id: playerId } },
      entries: { create: { playerId, kind: "deposit", amount: FUND_CREATION_COST } },
    },
  });
  await recordEvent(playerId, "fund_created", { nickname, fund: cleanName });
  return { ok: true, value: { id: fund.id, cost: FUND_CREATION_COST } };
}

export async function joinFund(playerId: string, nickname: string, fundId: string, currentFundId: string | null): Promise<FundResult<{ name: string }>> {
  if (currentFundId) return { ok: false, error: "already_in_fund" };
  const fund = await prisma.gameFund.findUnique({ where: { id: fundId }, select: { id: true, name: true } });
  if (!fund) return { ok: false, error: "not_found" };
  await prisma.gamePlayer.update({ where: { id: playerId }, data: { fundId } });
  await recordEvent(playerId, "fund_joined", { nickname, fund: fund.name });
  return { ok: true, value: { name: fund.name } };
}

/**
 * Выход из фонда возвращает игроку его чистый вклад: он уходит с тем, что
 * принёс (минус уже забранное). Владелец выйти не может — сначала фонд надо
 * распустить, иначе у команды остался бы котёл без хозяина.
 */
export async function leaveFund(playerId: string, fundId: string | null): Promise<FundResult<{ refund: number }>> {
  if (!fundId) return { ok: false, error: "not_member" };
  const fund = await prisma.gameFund.findUnique({ where: { id: fundId }, select: { ownerId: true } });
  if (!fund) return { ok: false, error: "not_found" };
  if (fund.ownerId === playerId) return { ok: false, error: "owner_cannot_leave" };

  const share = await memberShare(fundId, playerId);
  const refund = Math.max(0, Math.min(share, await fundCapital(fundId)));
  await prisma.$transaction([
    prisma.gameFundEntry.create({ data: { fundId, playerId, kind: "withdraw", amount: refund } }),
    prisma.gameFund.update({ where: { id: fundId }, data: { capital: { decrement: refund } } }),
    prisma.gamePlayer.update({ where: { id: playerId }, data: { fundId: null } }),
  ]);
  return { ok: true, value: { refund } };
}

/** Чистый вклад участника: внесённое минус забранное плюс полученные выплаты. */
export async function memberShare(fundId: string, playerId: string): Promise<number> {
  const entries = await prisma.gameFundEntry.findMany({
    where: { fundId, playerId },
    select: { kind: true, amount: true },
  });
  return entries.reduce((sum, e) => (e.kind === "withdraw" ? sum - e.amount : sum + e.amount), 0);
}

async function fundCapital(fundId: string): Promise<number> {
  const fund = await prisma.gameFund.findUnique({ where: { id: fundId }, select: { capital: true } });
  return fund?.capital ?? 0;
}

export async function depositToFund(playerId: string, fundId: string | null, amount: number): Promise<FundResult<{ amount: number }>> {
  if (!fundId) return { ok: false, error: "not_member" };
  if (!(amount >= MIN_FUND_DEPOSIT)) return { ok: false, error: "invalid_amount" };
  await prisma.$transaction([
    prisma.gameFundEntry.create({ data: { fundId, playerId, kind: "deposit", amount } }),
    prisma.gameFund.update({ where: { id: fundId }, data: { capital: { increment: amount } } }),
  ]);
  return { ok: true, value: { amount } };
}

export async function withdrawFromFund(playerId: string, fundId: string | null, amount: number): Promise<FundResult<{ amount: number }>> {
  if (!fundId) return { ok: false, error: "not_member" };
  if (!(amount > 0)) return { ok: false, error: "invalid_amount" };
  const share = await memberShare(fundId, playerId);
  if (amount > share) return { ok: false, error: "exceeds_share" };
  if (amount > (await fundCapital(fundId))) return { ok: false, error: "insufficient_capital" };
  await prisma.$transaction([
    prisma.gameFundEntry.create({ data: { fundId, playerId, kind: "withdraw", amount } }),
    prisma.gameFund.update({ where: { id: fundId }, data: { capital: { decrement: amount } } }),
  ]);
  return { ok: true, value: { amount } };
}

/**
 * Владелец распределяет прибыль между участниками пропорционально их
 * вкладам, удерживая комиссию фонда — та же схема, по которой живут
 * настоящие фонды, и повод собирать капитал не «в никуда».
 */
export async function payoutFund(ownerId: string, fundId: string | null, amount: number): Promise<FundResult<{ distributed: number }>> {
  if (!fundId) return { ok: false, error: "not_member" };
  const fund = await prisma.gameFund.findUnique({
    where: { id: fundId },
    select: { ownerId: true, capital: true, feePct: true, members: { select: { id: true } } },
  });
  if (!fund) return { ok: false, error: "not_found" };
  if (fund.ownerId !== ownerId) return { ok: false, error: "not_owner" };
  if (!(amount > 0)) return { ok: false, error: "invalid_amount" };
  if (amount > fund.capital) return { ok: false, error: "insufficient_capital" };

  const shares = await Promise.all(
    fund.members.map(async (m) => ({ id: m.id, share: Math.max(0, await memberShare(fundId, m.id)) })),
  );
  const total = shares.reduce((sum, s) => sum + s.share, 0);
  if (total <= 0) return { ok: false, error: "invalid_amount" };

  const netAmount = amount * (1 - fund.feePct / 100);
  const ops = shares
    .filter((s) => s.share > 0)
    .map((s) => {
      const part = Math.round((netAmount * s.share) / total * 100) / 100;
      return [
        prisma.gameFundEntry.create({ data: { fundId, playerId: s.id, kind: "payout", amount: part } }),
        // Выплата уходит в очередь: участник заберёт её в игру при
        // следующей синхронизации, как и проценты по займам.
        prisma.gamePlayer.update({ where: { id: s.id }, data: { pendingPayout: { increment: part } } }),
      ];
    })
    .flat();

  await prisma.$transaction([
    ...ops,
    prisma.gameFund.update({ where: { id: fundId }, data: { capital: { decrement: amount } } }),
  ]);
  return { ok: true, value: { distributed: netAmount } };
}

/** Рейтинг фондов: капитал в котле + суммарная эквити участников. */
export async function fundBoard(limit = 15) {
  const funds = await prisma.gameFund.findMany({
    orderBy: { capital: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      motto: true,
      capital: true,
      feePct: true,
      createdAt: true,
      owner: { select: { nickname: true } },
      members: { select: { id: true, nickname: true, equity: true, contractsPassed: true } },
    },
  });
  return funds
    .map((f) => ({
      ...f,
      memberCount: f.members.length,
      totalEquity: f.members.reduce((sum, m) => sum + m.equity, 0),
      power: f.capital + f.members.reduce((sum, m) => sum + m.equity, 0),
    }))
    .sort((a, b) => b.power - a.power);
}
