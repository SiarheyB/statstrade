// Выход фонда на биржу.
//
// Фонд собирает деньги участников и торгует ими. Пока его нельзя было
// оценить со стороны: вложиться можно, только вступив, а продать долю —
// только выйдя из фонда целиком. Листинг это меняет: у фонда появляется
// акция с тикером, её видно на графике, её можно купить и продать в любой
// момент, не спрашивая владельца.
//
// ТРЕБОВАНИЯ К ЛИСТИНГУ взяты по смыслу с настоящих бирж, где на торги не
// пускают кого попало: нужны история работы, размер, распылённость среди
// владельцев и вменяемое руководство. Без этих условий листинг превратился
// бы в кнопку «создать себе бумагу», а такие бумаги никому не нужны.
//
// КАК УСТРОЕНО ТЕХНИЧЕСКИ. Генератор рынка статичен — инструменты лежат в
// справочнике и не меняются, иначе история перестала бы воспроизводиться.
// Поэтому в справочнике заранее зарезервированы восемь СЛОТОВ, а листинг
// закрепляет слот за фондом и вешает на него имя и тикер. Генератор про
// фонды не знает вовсе: он как считал свечи по номеру бара, так и считает.
import { prisma } from "@/lib/db";

/** Сколько всего фондов может быть на бирже: столько слотов в справочнике. */
export const LISTING_SLOTS = [
  "FND_SLOT_1",
  "FND_SLOT_2",
  "FND_SLOT_3",
  "FND_SLOT_4",
  "FND_SLOT_5",
  "FND_SLOT_6",
  "FND_SLOT_7",
  "FND_SLOT_8",
];

/** Сколько дней фонд должен проработать до выхода на биржу. */
export const MIN_AGE_DAYS = 14;
/** Минимальный капитал. */
export const MIN_CAPITAL = 100_000;
/** Минимум участников: аналог требования к числу акционеров. */
export const MIN_MEMBERS = 3;
/** Минимум пройденных испытаний у владельца: аналог требований к руководству. */
export const MIN_OWNER_CONTRACTS = 1;
/** Сколько акций выпускается при листинге. */
export const SHARES_ISSUED = 1_000_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ListingError =
  | "no_fund"
  | "not_owner"
  | "already_listed"
  | "too_young"
  | "too_small"
  | "too_few_members"
  | "owner_not_ready"
  | "no_slots"
  | "ticker_taken"
  | "bad_ticker";

export type ListingResult<T> = { ok: true; value: T } | { ok: false; error: ListingError };

export interface ListingRequirements {
  ageDays: number;
  capital: number;
  members: number;
  ownerContracts: number;
  meets: {
    age: boolean;
    capital: boolean;
    members: boolean;
    owner: boolean;
  };
  ready: boolean;
}

/** Тикер: три-пять заглавных латинских букв, как на настоящих биржах. */
export function normalizeTicker(raw: string): string | null {
  const clean = raw.trim().toUpperCase().replace(/[^A-Z]/g, "");
  return clean.length >= 3 && clean.length <= 5 ? clean : null;
}

/** Готов ли фонд к листингу и чего ему не хватает. */
export async function listingRequirements(fundId: string): Promise<ListingRequirements | null> {
  const fund = await prisma.gameFund.findUnique({
    where: { id: fundId },
    select: {
      capital: true,
      createdAt: true,
      owner: { select: { contractsPassed: true } },
      _count: { select: { members: true } },
    },
  });
  if (!fund) return null;

  const ageDays = (Date.now() - fund.createdAt.getTime()) / DAY_MS;
  const meets = {
    age: ageDays >= MIN_AGE_DAYS,
    capital: fund.capital >= MIN_CAPITAL,
    members: fund._count.members >= MIN_MEMBERS,
    owner: fund.owner.contractsPassed >= MIN_OWNER_CONTRACTS,
  };
  return {
    ageDays,
    capital: fund.capital,
    members: fund._count.members,
    ownerContracts: fund.owner.contractsPassed,
    meets,
    ready: meets.age && meets.capital && meets.members && meets.owner,
  };
}

/** Свободный слот в справочнике. */
export async function freeSlot(): Promise<string | null> {
  const taken = await prisma.gameListing.findMany({ select: { assetId: true } });
  const used = new Set(taken.map((row) => row.assetId));
  return LISTING_SLOTS.find((slot) => !used.has(slot)) ?? null;
}

export async function listFund(
  playerId: string,
  fundId: string,
  ticker: string,
): Promise<ListingResult<{ assetId: string; ticker: string }>> {
  const fund = await prisma.gameFund.findUnique({
    where: { id: fundId },
    select: { ownerId: true, name: true, listing: { select: { id: true } } },
  });
  if (!fund) return { ok: false, error: "no_fund" };
  if (fund.ownerId !== playerId) return { ok: false, error: "not_owner" };
  if (fund.listing) return { ok: false, error: "already_listed" };

  const req = await listingRequirements(fundId);
  if (!req) return { ok: false, error: "no_fund" };
  if (!req.meets.age) return { ok: false, error: "too_young" };
  if (!req.meets.capital) return { ok: false, error: "too_small" };
  if (!req.meets.members) return { ok: false, error: "too_few_members" };
  if (!req.meets.owner) return { ok: false, error: "owner_not_ready" };

  const clean = normalizeTicker(ticker);
  if (!clean) return { ok: false, error: "bad_ticker" };
  const taken = await prisma.gameListing.findUnique({ where: { ticker: clean } });
  if (taken) return { ok: false, error: "ticker_taken" };

  const slot = await freeSlot();
  if (!slot) return { ok: false, error: "no_slots" };

  await prisma.$transaction([
    prisma.gameListing.create({
      data: { fundId, assetId: slot, ticker: clean, name: fund.name, totalShares: SHARES_ISSUED },
    }),
    prisma.gameWorldEvent.create({
      data: {
        playerId,
        kind: "fund_listed",
        payload: JSON.stringify({ fund: fund.name, ticker: clean }),
      },
    }),
  ]);

  return { ok: true, value: { assetId: slot, ticker: clean } };
}

/**
 * Все листинги: клиент переименовывает по ним слоты в своём справочнике.
 *
 * Ряд общий для фондов и банков игроков — терминалу всё равно, кто эмитент,
 * ему нужны тикер, имя и ориентир стоимости. Отличает их поле kind.
 */
export async function allListings() {
  const rows = await prisma.gameListing.findMany({
    orderBy: { listedAt: "asc" },
    select: {
      kind: true,
      assetId: true,
      ticker: true,
      name: true,
      totalShares: true,
      sharesSold: true,
      listedAt: true,
      fund: { select: { id: true, capital: true, owner: { select: { nickname: true } } } },
      bank: {
        select: { id: true, capital: true, bondsIssued: true, owner: { select: { nickname: true } } },
      },
    },
  });
  return rows.map((row) => {
    // Балансовая стоимость бумаги: капитал эмитента на выпущенную бумагу.
    // У банка из капитала вычитается долг по облигациям — иначе заём
    // выглядел бы прибавкой к собственным средствам.
    const capital = row.bank ? row.bank.capital - row.bank.bondsIssued : (row.fund?.capital ?? 0);
    return {
      kind: row.kind,
      assetId: row.assetId,
      ticker: row.ticker,
      name: row.name,
      totalShares: row.totalShares,
      sharesSold: row.sharesSold,
      listedAt: row.listedAt.getTime(),
      fundId: row.fund?.id ?? null,
      bankId: row.bank?.id ?? null,
      capital,
      owner: row.bank?.owner.nickname ?? row.fund?.owner.nickname ?? "—",
      bookValuePerShare: row.totalShares > 0 ? capital / row.totalShares : 0,
    };
  });
}

/**
 * Размещение акций фонда.
 *
 * Цена — БИРЖЕВАЯ, как и у банка: продавай фонд свои акции по балансу, пока
 * на бирже дороже, эта разница была бы бесплатными деньгами. Выручка идёт в
 * капитал фонда — именно ради неё на биржу и выходят.
 */
export async function placeShares(
  fundId: string,
  quantity: number,
  marketPrice: number,
): Promise<ListingResult<{ sold: number; total: number }>> {
  const listing = await prisma.gameListing.findUnique({ where: { fundId } });
  if (!listing) return { ok: false, error: "no_fund" };
  const available = listing.totalShares - listing.sharesSold;
  const sold = Math.min(available, Math.max(0, quantity));
  if (!(sold > 0) || !(marketPrice > 0)) return { ok: false, error: "too_small" };
  const total = sold * marketPrice;

  await prisma.$transaction([
    prisma.gameListing.update({ where: { fundId }, data: { sharesSold: { increment: sold } } }),
    prisma.gameFund.update({ where: { id: fundId }, data: { capital: { increment: total } } }),
  ]);
  return { ok: true, value: { sold, total } };
}
