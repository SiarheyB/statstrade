// Банк игрока.
//
// ЧТО ЭТО. Не второй центробанк: кредитов другим игрокам банк игрока не
// выдаёт — чужие деньги под чужой риск это отдельная и намного большая
// механика. Банк игрока — ЭМИТЕНТ: у него появляются своя акция и своя
// облигация, которые видит и может купить любой игрок в терминале, как
// любую другую бумагу. Смысл для владельца — размещать бумаги на бирже и
// собирать выручку в капитал; смысл для остальных — ещё два инструмента,
// за которыми стоит живой человек, а не генератор.
//
// ПОЧЕМУ ЭТО ТРУДНО ПОЛУЧИТЬ. Банк, который заводит любой накопивший
// миллион, обесценивает и бумагу, и сам жест: на бирже висели бы четыре
// пустышки. Поэтому требований пять, и деньги — только одно из них
// (см. CHARTER). Репутация, стаж и пройденные испытания не покупаются, а
// уставный взнос уходит регулятору (капитал центробанка) безвозвратно —
// это не депозит, его нельзя забрать назад.
//
// КАК УСТРОЕНО ТЕХНИЧЕСКИ. Так же, как листинг фонда (см. listing.ts):
// генератор рынка статичен, инструменты лежат в справочнике и не меняются,
// иначе история перестала бы воспроизводиться. В справочнике заранее
// зарезервированы ЧЕТЫРЕ ПАРЫ слотов (акция + облигация), учреждение банка
// закрепляет пару за банком и вешает на неё имя и тикеры.
import { prisma } from "@/lib/db";
import { playerEquity, recordEvent } from "@/lib/game/world";
import { getBank } from "@/lib/game/bank";
import { normalizeTicker } from "@/lib/game/listing";

/** Пары слотов в справочнике: сколько банков может существовать всего. */
export const BANK_SLOTS = [
  { share: "UBK_SHARE_1", bond: "UBK_BOND_1" },
  { share: "UBK_SHARE_2", bond: "UBK_BOND_2" },
  { share: "UBK_SHARE_3", bond: "UBK_BOND_3" },
  { share: "UBK_SHARE_4", bond: "UBK_BOND_4" },
];

/**
 * Условия получения лицензии. Подобраны так, чтобы банк был поводом, а не
 * покупкой: уставный взнос отсекает случайных, а престиж, стаж, испытания
 * и репутация — тех, кто просто удачно занял и не собирается задерживаться.
 */
export const CHARTER = {
  /** Уставный взнос: уходит регулятору, назад не возвращается. */
  deposit: 250_000,
  prestige: 150,
  contracts: 5,
  /** Репутация заёмщика: с просрочками лицензию не дают. */
  reliability: 90,
  /** Стаж счёта в РЕАЛЬНЫХ днях — не в игровых, их можно намотать за вечер. */
  ageDays: 21,
};

/** Сколько бумаг выпускается при учреждении. */
export const SHARES_ISSUED = 1_000_000;
export const BONDS_ISSUED = 500_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type UserBankError =
  | "no_player"
  | "already_owner"
  | "not_ready"
  | "no_slots"
  | "no_bank"
  | "bad_name"
  | "bad_ticker"
  | "ticker_taken"
  | "nothing_left"
  | "bad_amount";

export type UserBankResult<T> = { ok: true; value: T } | { ok: false; error: UserBankError };

export interface CharterRequirements {
  equity: number;
  prestige: number;
  contracts: number;
  reliability: number;
  ageDays: number;
  meets: {
    deposit: boolean;
    prestige: boolean;
    contracts: boolean;
    reliability: boolean;
    age: boolean;
  };
  ready: boolean;
  /** Свободные лицензии: их всего четыре на весь мир. */
  slotsLeft: number;
}

/** Тикер облигации выводится из тикера акции: одна семья бумаг, разные буквы. */
export function bondTicker(shareTicker: string): string {
  return `${shareTicker.slice(0, 4)}B`;
}

export async function freeBankSlot(): Promise<{ share: string; bond: string } | null> {
  const taken = await prisma.gameListing.findMany({ select: { assetId: true } });
  const used = new Set(taken.map((row) => row.assetId));
  return BANK_SLOTS.find((pair) => !used.has(pair.share) && !used.has(pair.bond)) ?? null;
}

async function slotsLeft(): Promise<number> {
  const taken = await prisma.gameListing.findMany({ select: { assetId: true } });
  const used = new Set(taken.map((row) => row.assetId));
  return BANK_SLOTS.filter((pair) => !used.has(pair.share) && !used.has(pair.bond)).length;
}

/** Что у игрока уже есть для лицензии и чего не хватает. */
export async function charterRequirements(playerId: string): Promise<CharterRequirements | null> {
  const player = await prisma.gamePlayer.findUnique({
    where: { id: playerId },
    select: { equity: true, prestige: true, contractsPassed: true, reliability: true, createdAt: true },
  });
  if (!player) return null;

  const ageDays = (Date.now() - player.createdAt.getTime()) / DAY_MS;
  const meets = {
    deposit: player.equity >= CHARTER.deposit,
    prestige: player.prestige >= CHARTER.prestige,
    contracts: player.contractsPassed >= CHARTER.contracts,
    reliability: player.reliability >= CHARTER.reliability,
    age: ageDays >= CHARTER.ageDays,
  };
  return {
    equity: player.equity,
    prestige: player.prestige,
    contracts: player.contractsPassed,
    reliability: player.reliability,
    ageDays,
    meets,
    ready: Object.values(meets).every(Boolean),
    slotsLeft: await slotsLeft(),
  };
}

/** Название банка: живое имя, а не строка любой длины из чего попало. */
function normalizeName(raw: string): string | null {
  const clean = raw.trim().replace(/\s+/g, " ");
  return clean.length >= 3 && clean.length <= 40 ? clean : null;
}

/**
 * Учреждение банка. Взнос списывается ЯКОРЕМ на эквити (playerEquity):
 * баланс живёт у клиента, и без этой проверки лицензию выписывал бы себе
 * любой, кто отправил запрос — деньгами, которых у него нет.
 */
export async function foundBank(
  playerId: string,
  rawName: string,
  rawTicker: string,
  rawMotto?: string,
): Promise<UserBankResult<{ bankId: string; share: string; bond: string }>> {
  const existing = await prisma.gameUserBank.findUnique({ where: { ownerId: playerId }, select: { id: true } });
  if (existing) return { ok: false, error: "already_owner" };

  const name = normalizeName(rawName);
  if (!name) return { ok: false, error: "bad_name" };
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return { ok: false, error: "bad_ticker" };
  const bond = bondTicker(ticker);

  const req = await charterRequirements(playerId);
  if (!req) return { ok: false, error: "no_player" };
  if (!req.ready) return { ok: false, error: "not_ready" };
  // Эквити читается ещё раз, отдельно от требований: между проверкой и
  // списанием игрок мог просесть, а взнос обязан быть обеспечен.
  if ((await playerEquity(playerId)) < CHARTER.deposit) return { ok: false, error: "not_ready" };

  const clash = await prisma.gameListing.findFirst({
    where: { ticker: { in: [ticker, bond] } },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "ticker_taken" };

  const slot = await freeBankSlot();
  if (!slot) return { ok: false, error: "no_slots" };

  const motto = rawMotto?.trim().slice(0, 120) || null;
  const regulator = await getBank();

  try {
    const bank = await prisma.$transaction(async (tx) => {
      const created = await tx.gameUserBank.create({
        data: { ownerId: playerId, name, motto },
      });
      await tx.gameListing.create({
        data: {
          kind: "bank_share",
          bankId: created.id,
          assetId: slot.share,
          ticker,
          name: `${name} — акция`,
          totalShares: SHARES_ISSUED,
        },
      });
      await tx.gameListing.create({
        data: {
          kind: "bank_bond",
          bankId: created.id,
          assetId: slot.bond,
          ticker: bond,
          name: `${name} — облигация`,
          totalShares: BONDS_ISSUED,
        },
      });
      // Взнос уходит регулятору: у игрока он списывается на клиенте по
      // ответу, здесь важно, что деньги НЕ появляются из воздуха в общем
      // балансе мира, а перетекают в капитал центробанка.
      await tx.gameBank.update({
        where: { id: regulator.id },
        data: { capital: { increment: CHARTER.deposit } },
      });
      return created;
    });

    await recordEvent(playerId, "bank_founded", { bank: name, ticker });
    return { ok: true, value: { bankId: bank.id, share: slot.share, bond: slot.bond } };
  } catch {
    // Гонка за слотом или тикером: уникальные индексы ловят второго,
    // который прошёл проверку одновременно с первым.
    return { ok: false, error: "no_slots" };
  }
}

/** Свой банк со своими бумагами — то, что видит владелец в разделе банка. */
export async function myBank(playerId: string) {
  const bank = await prisma.gameUserBank.findUnique({
    where: { ownerId: playerId },
    // Акция первой, облигация второй: доля в банке — главная бумага, долг —
    // производная от неё. Сортировка по kind дала бы обратный порядок.
    include: { listings: { orderBy: { kind: "desc" } } },
  });
  if (!bank) return null;
  return {
    id: bank.id,
    name: bank.name,
    motto: bank.motto,
    capital: bank.capital,
    bondsIssued: bank.bondsIssued,
    createdAt: bank.createdAt.getTime(),
    papers: bank.listings.map((row) => ({
      kind: row.kind,
      assetId: row.assetId,
      ticker: row.ticker,
      name: row.name,
      total: row.totalShares,
      sold: row.sharesSold,
    })),
  };
}

/**
 * Размещение бумаги на бирже.
 *
 * Цена — БИРЖЕВАЯ, как у фонда и у центробанка: разреши продавать по
 * балансовой, пока на бирже дороже, и разница станет бесплатными деньгами.
 * Выручка идёт в капитал банка, а по облигации ещё и в долг: облигация —
 * заём, и балансовая стоимость акции обязана его учитывать.
 */
export async function issuePaper(
  playerId: string,
  kind: "bank_share" | "bank_bond",
  quantity: number,
  marketPrice: number,
): Promise<UserBankResult<{ sold: number; total: number }>> {
  const bank = await prisma.gameUserBank.findUnique({ where: { ownerId: playerId }, select: { id: true } });
  if (!bank) return { ok: false, error: "no_bank" };
  if (!(quantity > 0) || !(marketPrice > 0)) return { ok: false, error: "bad_amount" };

  const listing = await prisma.gameListing.findFirst({
    where: { bankId: bank.id, kind },
    select: { id: true, totalShares: true, sharesSold: true },
  });
  if (!listing) return { ok: false, error: "no_bank" };

  const available = listing.totalShares - listing.sharesSold;
  const sold = Math.min(available, quantity);
  if (!(sold > 0)) return { ok: false, error: "nothing_left" };
  const total = sold * marketPrice;

  // Заявкой, а не чтением с последующей записью: два одновременных
  // размещения иначе продали бы один и тот же остаток дважды.
  const claimed = await prisma.gameListing.updateMany({
    where: { id: listing.id, sharesSold: listing.sharesSold },
    data: { sharesSold: { increment: sold } },
  });
  if (claimed.count === 0) return { ok: false, error: "nothing_left" };

  await prisma.gameUserBank.update({
    where: { id: bank.id },
    data:
      kind === "bank_bond"
        ? { capital: { increment: total }, bondsIssued: { increment: total } }
        : { capital: { increment: total } },
  });

  return { ok: true, value: { sold, total } };
}
