// Игровой банк: кредиты, облигации, акции и витрина изъятого.
//
// До него занять можно было только у другого игрока — а пока в мире два
// человека, занять не у кого вовсе. Банк работает всегда и сам развивается:
// капитал растёт на процентах, падает на невозвратах, и от него зависит цена
// его акции. То есть банк — не декорация, а участник, за которым можно
// наблюдать и в которого можно вложиться.
//
// ГДЕ ЧЬИ ДЕНЬГИ. Игровой баланс живёт в браузере, сервер хранит
// обязательства. Поэтому: выдача — сервер записывает кредит, клиент зачисляет
// деньги себе в наличные; погашение — клиент списывает у себя, сервер
// закрывает кредит и увеличивает капитал. Выплаты банка идут через ту же
// очередь получения, что проценты по займам и призы сезона.
import { prisma } from "@/lib/db";
import { getShopItem } from "@/engine/economy/shop";
import { playerEquity } from "@/lib/game/world";
import {
  canPledge,
  collateralLoan,
  creditScore,
  rateFor,
  repossessionPrice,
  scoreBand,
  unsecuredLimit,
  type CreditProfile,
} from "@/lib/game/credit";

/** Стартовый капитал банка — один триллион. */
export const DEFAULT_BANK_CAPITAL = 1_000_000_000_000;
/**
 * Сколько акций выпущено при основании.
 *
 * Десять миллиардов на триллион капитала дают балансовую цену в сто долларов
 * за акцию. Число выбрано именно из этого: акция за десять миллионов не
 * торгуется, её нельзя купить на стартовые деньги. У настоящих банков
 * порядок тот же — миллиарды акций по двузначной-трёхзначной цене.
 */
export const BANK_TOTAL_SHARES = 10_000_000_000;
/**
 * Ставка по ВКЛАДУ, годовых.
 *
 * Вклад и облигация — разные вещи, и путать их нельзя. Вклад открывается
 * прямо в банке, лежит до срока и гасится по номиналу с процентами: результат
 * известен заранее. Облигация банка (тикер BNKB) торгуется на бирже, её цена
 * ходит, и продать её можно в любой момент — но по той цене, что дают.
 */
export const DEPOSIT_RATE_PCT = 6;
/** Сроки вкладов, дни. */
export const DEPOSIT_TERMS = [7, 30, 90];
/** Минимальная сумма вклада. */
export const MIN_DEPOSIT = 500;
/**
 * Какую долю капитала банк держит в резерве.
 *
 * Банк не выдаёт последние деньги: если раздать всё, первый же невозврат
 * оставит его без средств на выплаты по облигациям. У настоящих банков это
 * норматив достаточности капитала, здесь — простая доля.
 */
export const RESERVE_RATIO = 0.2;

/** Инструменты банка на бирже. */
export const BANK_SHARE_ASSET = "STK_GAMEBANK";
export const BANK_BOND_ASSET = "BND_GAMEBANK";

const DAY_MS = 24 * 60 * 60 * 1000;

export type BankError =
  | "no_bank"
  | "too_small"
  | "over_limit"
  | "bad_collateral"
  | "not_enough_capital"
  | "not_found"
  | "already_repaid"
  | "not_owner"
  | "sold_out"
  | "not_matured";

export type BankResult<T> = { ok: true; value: T } | { ok: false; error: BankError };

/** Банк мира. Создаётся при первом обращении. */
export async function getBank() {
  const existing = await prisma.gameBank.findFirst();
  if (existing) return existing;
  try {
    return await prisma.gameBank.create({
      data: { capital: DEFAULT_BANK_CAPITAL, totalShares: BANK_TOTAL_SHARES },
    });
  } catch {
    const bank = await prisma.gameBank.findFirst();
    if (bank) return bank;
    throw new Error("Не удалось создать банк");
  }
}

/** Сколько банк может выдать прямо сейчас. */
export function lendingCapacity(bank: { capital: number; lentOut: number; bondsIssued: number }): number {
  // Привлечённое по облигациям тоже можно выдавать — на этом банки и живут, —
  // но резерв неприкосновенен.
  const funds = bank.capital + bank.bondsIssued;
  return Math.max(0, funds * (1 - RESERVE_RATIO) - bank.lentOut);
}

/**
 * БАЛАНСОВАЯ стоимость акции: капитал за вычетом долга, делённый на акции.
 *
 * Это не цена на бирже, а ориентир — сколько банк стоит «по бумагам».
 * Биржевая цена акции BNKX ходит сама и может быть выше или ниже балансовой;
 * их отношение (P/B) — обычный способ понять, дорого банк оценён или дёшево,
 * и здесь он работает так же.
 */
export function bookValuePerShare(bank: { capital: number; bondsIssued: number; totalShares: number }): number {
  const equity = Math.max(0, bank.capital - bank.bondsIssued);
  return Math.max(0.01, equity / Math.max(1, bank.totalShares));
}

// ── Скоринг и кредиты ─────────────────────────────────────────────────────

/** Кредитное досье игрока: то, на что смотрит банк перед выдачей. */
export async function creditFile(playerId: string, equity: number, bankruptcies: number) {
  const player = await prisma.gamePlayer.findUnique({
    where: { id: playerId },
    select: { reliability: true, contractsPassed: true, createdAt: true },
  });
  const active = await prisma.gameBankLoan.findMany({
    where: { playerId, status: "active" },
    select: { principal: true },
  });
  const currentDebt = active.reduce((sum, loan) => sum + loan.principal, 0);

  const profile: CreditProfile = {
    reliability: player?.reliability ?? 100,
    bankruptcies,
    contractsPassed: player?.contractsPassed ?? 0,
    equity,
    currentDebt,
    ageDays: player ? Math.max(0, (Date.now() - player.createdAt.getTime()) / DAY_MS) : 0,
  };
  const score = creditScore(profile);
  return {
    profile,
    score,
    band: scoreBand(score),
    currentDebt,
    unsecuredLimit: Math.floor(unsecuredLimit(score, equity, currentDebt)),
    unsecuredRate: rateFor(score, false),
    securedRate: rateFor(score, true),
  };
}

export interface LoanRequest {
  amount: number;
  termDays: number;
  /** Предмет из магазина в залог. Без него кредит необеспеченный. */
  collateralItem?: string | null;
  /**
   * Что игрок у себя имеет.
   *
   * Имущество живёт в браузере, сервер его не хранит — как и деньги. Поэтому
   * владение залогом приходится принимать со слов клиента, ровно как эквити
   * в синхронизации мира. Но принимать МОЛЧА нельзя: без этой проверки можно
   * было заложить яхту, которой нет, и получить деньги из воздуха.
   */
  ownedItems?: string[];
}

/** Минимальная сумма кредита: ниже банк не работает. */
export const MIN_LOAN = 500;

export async function takeBankLoan(
  playerId: string,
  equity: number,
  bankruptcies: number,
  request: LoanRequest,
): Promise<BankResult<{ id: string; amount: number; ratePct: number; dueAt: number }>> {
  if (!(request.amount >= MIN_LOAN)) return { ok: false, error: "too_small" };
  const bank = await getBank();
  const file = await creditFile(playerId, equity, bankruptcies);

  let limit = file.unsecuredLimit;
  let rate = file.unsecuredRate;
  let collateralValue: number | null = null;

  if (request.collateralItem) {
    if (!canPledge(request.collateralItem)) return { ok: false, error: "bad_collateral" };
    // Заложить можно только своё.
    if (!(request.ownedItems ?? []).includes(request.collateralItem)) return { ok: false, error: "bad_collateral" };
    // И только один раз: вещь, уже лежащая в залоге, второй кредит не
    // обеспечивает.
    const pledged = await prisma.gameBankLoan.findFirst({
      where: { playerId, status: "active", collateralItem: request.collateralItem },
      select: { id: true },
    });
    if (pledged) return { ok: false, error: "bad_collateral" };
    const item = getShopItem(request.collateralItem)!;
    // Под залог дают ДОЛЮ от стоимости вещи (LTV), а не всю стоимость: банк
    // должен продать её с запасом, даже если рынок просел.
    collateralValue = item.price;
    limit = collateralLoan(item);
    rate = file.securedRate;
  }

  if (request.amount > limit) return { ok: false, error: "over_limit" };
  if (request.amount > lendingCapacity(bank)) return { ok: false, error: "not_enough_capital" };

  const termDays = Math.max(1, Math.min(365, Math.round(request.termDays)));
  const dueAt = new Date(Date.now() + termDays * DAY_MS);

  const [loan] = await prisma.$transaction([
    prisma.gameBankLoan.create({
      data: {
        playerId,
        principal: request.amount,
        ratePct: rate,
        termDays,
        dueAt,
        collateralItem: request.collateralItem ?? null,
        collateralValue,
      },
    }),
    prisma.gameBank.update({
      where: { id: bank.id },
      data: { lentOut: { increment: request.amount } },
    }),
  ]);

  return { ok: true, value: { id: loan.id, amount: request.amount, ratePct: rate, dueAt: dueAt.getTime() } };
}

/** Сколько нужно вернуть по кредиту прямо сейчас. */
export function amountDue(loan: { principal: number; ratePct: number; takenAt: Date }, now = Date.now()): number {
  // Проценты капают за фактическое время пользования, а не «за срок»:
  // вернувший через день не должен платить как за месяц.
  const years = Math.max(0, (now - loan.takenAt.getTime()) / (365 * DAY_MS));
  return loan.principal * (1 + (loan.ratePct / 100) * years);
}

export async function repayBankLoan(playerId: string, loanId: string): Promise<BankResult<{ paid: number }>> {
  const loan = await prisma.gameBankLoan.findUnique({ where: { id: loanId } });
  if (!loan) return { ok: false, error: "not_found" };
  if (loan.playerId !== playerId) return { ok: false, error: "not_owner" };
  if (loan.status !== "active") return { ok: false, error: "already_repaid" };

  const bank = await getBank();
  const paid = amountDue(loan);
  const interest = paid - loan.principal;

  await prisma.$transaction([
    prisma.gameBankLoan.update({
      where: { id: loanId },
      data: { status: "repaid", repaidAt: new Date() },
    }),
    prisma.gameBank.update({
      where: { id: bank.id },
      data: {
        lentOut: { decrement: loan.principal },
        capital: { increment: interest },
        interestEarned: { increment: interest },
      },
    }),
    // Вернул вовремя — репутация заёмщика растёт. Это и есть кредитная
    // история: следующий кредит будет дешевле.
    prisma.gamePlayer.update({
      where: { id: playerId },
      data: { reliability: { increment: 2 } },
    }),
  ]);

  return { ok: true, value: { paid } };
}

/**
 * Просроченные кредиты: списать в убыток и забрать залог.
 *
 * Вызывается лениво, при обращении к банку, — тем же приёмом, что смена
 * сезона и турнира. Фоновый процесс пришлось бы держать живым круглосуточно.
 */
export async function collectOverdue(now = Date.now()): Promise<number> {
  const overdue = await prisma.gameBankLoan.findMany({
    where: { status: "active", dueAt: { lt: new Date(now) } },
  });
  if (overdue.length === 0) return 0;
  const bank = await getBank();

  let collected = 0;
  for (const loan of overdue) {
    // Заявка на взыскание: помечаем заём просроченным ПЕРВЫМ действием и
    // только по ещё активному. Взыскание запускается лениво, на первом же
    // запросе к банку, — и два одновременных запроса изымали залог дважды:
    // в списке изъятого появлялись две записи, а капитал банка дважды
    // получал по одному и тому же убытку.
    const claimed = await prisma.gameBankLoan.updateMany({
      where: { id: loan.id, status: "active" },
      data: { status: "defaulted" },
    });
    if (claimed.count === 0) continue;
    collected++;
    const item = loan.collateralItem ? getShopItem(loan.collateralItem) : undefined;
    // Изъятое банк не оставляет себе: ему нужны деньги, а не яхта. Продаёт
    // со скидкой — для остальных игроков это способ купить дорогую вещь
    // дешевле магазина.
    const recovery = item ? repossessionPrice(item) : 0;
    const loss = Math.max(0, loan.principal - recovery);

    const player = await prisma.gamePlayer.findUnique({ where: { id: loan.playerId }, select: { seizedItems: true } });
    const seized: string[] = player?.seizedItems ? (JSON.parse(player.seizedItems) as string[]) : [];
    if (loan.collateralItem) seized.push(loan.collateralItem);

    await prisma.$transaction([
      prisma.gameBank.update({
        where: { id: bank.id },
        data: {
          lentOut: { decrement: loan.principal },
          capital: { decrement: loss },
          lossesTaken: { increment: loss },
        },
      }),
      prisma.gamePlayer.update({
        where: { id: loan.playerId },
        data: {
          // Просрочка бьёт по репутации сильно: следующий кредит будет либо
          // дороже, либо только под залог.
          reliability: { decrement: 25 },
          seizedItems: loan.collateralItem ? JSON.stringify(seized) : undefined,
        },
      }),
      ...(item
        ? [
            prisma.gameRepossessed.create({
              data: { itemId: item.id, fromId: loan.playerId, price: recovery },
            }),
          ]
        : []),
      prisma.gameWorldEvent.create({
        data: {
          playerId: loan.playerId,
          kind: "bank_default",
          payload: JSON.stringify({ amount: Math.round(loan.principal), item: loan.collateralItem ?? null }),
        },
      }),
    ]);
  }
  return collected;
}

// ── Облигации банка ───────────────────────────────────────────────────────
//
// Игрок ОДАЛЖИВАЕТ банку и получает купон. Это единственный в игре инструмент
// с заранее известным результатом: альтернатива торговле для тех, кто не
// хочет рисковать, и способ для банка привлечь деньги, когда своего капитала
// на выдачу не хватает. Ровно так и работает банк в жизни — занимает у одних
// дешевле, выдаёт другим дороже.

export async function buyBond(
  playerId: string,
  amount: number,
  termDays: number,
): Promise<BankResult<{ id: string; maturesAt: number; couponPct: number; payout: number }>> {
  if (!(amount >= MIN_DEPOSIT)) return { ok: false, error: "too_small" };
  // Без этой проверки покупка ничего не стоила: сумма увеличивала капитал
  // банка безусловно, а через срок возвращалась С КУПОНОМ в pendingPayout —
  // печатный станок с задержкой в дни вместо секунд. Купить можно не больше
  // собственной эквити: облигация — это вложение РЕАЛЬНЫХ денег, а не запись
  // из воздуха.
  if (amount > (await playerEquity(playerId))) return { ok: false, error: "too_small" };
  const term = DEPOSIT_TERMS.includes(termDays) ? termDays : DEPOSIT_TERMS[0];
  const bank = await getBank();

  // Купон выше на длинном сроке: деньги, отданные надолго, стоят дороже —
  // это обычная форма кривой доходности.
  const couponPct = DEPOSIT_RATE_PCT * (term >= 90 ? 1.5 : term >= 30 ? 1.2 : 1);
  const maturesAt = new Date(Date.now() + term * DAY_MS);
  const payout = amount * (1 + (couponPct / 100) * (term / 365));

  const [bond] = await prisma.$transaction([
    prisma.gameBankBond.create({
      data: { playerId, amount, couponPct, termDays: term, maturesAt },
    }),
    prisma.gameBank.update({
      where: { id: bank.id },
      data: { bondsIssued: { increment: amount }, capital: { increment: amount } },
    }),
  ]);

  return { ok: true, value: { id: bond.id, maturesAt: maturesAt.getTime(), couponPct, payout } };
}

export async function redeemBond(playerId: string, bondId: string, now = Date.now()): Promise<BankResult<{ payout: number }>> {
  const bond = await prisma.gameBankBond.findUnique({ where: { id: bondId } });
  if (!bond) return { ok: false, error: "not_found" };
  if (bond.playerId !== playerId) return { ok: false, error: "not_owner" };
  if (bond.redeemedAt) return { ok: false, error: "already_repaid" };
  // Досрочно погасить нельзя: обещание на срок — это и есть облигация.
  if (bond.maturesAt.getTime() > now) return { ok: false, error: "not_matured" };

  const bank = await getBank();
  const payout = bond.amount * (1 + (bond.couponPct / 100) * (bond.termDays / 365));

  await prisma.$transaction([
    prisma.gameBankBond.update({ where: { id: bondId }, data: { redeemedAt: new Date(now) } }),
    prisma.gameBank.update({
      where: { id: bank.id },
      data: { bondsIssued: { decrement: bond.amount }, capital: { decrement: payout } },
    }),
    // Деньги — в очередь на получение, тем же каналом, что призы и проценты.
    prisma.gamePlayer.update({ where: { id: playerId }, data: { pendingPayout: { increment: payout } } }),
  ]);

  return { ok: true, value: { payout } };
}

// ── Акции банка ───────────────────────────────────────────────────────────
//
// Банк сам выступает маркет-мейкером: покупает и продаёт свои акции по
// балансовой цене. Биржевого стакана у него нет и быть не может — акция одна
// на мир, и держателей поначалу единицы; зато цена честно следует за тем, как
// банк работает.

/**
 * Первичное размещение акций банка.
 *
 * Цена — БИРЖЕВАЯ, а не балансовая, и это принципиально. Продавай банк свои
 * акции по балансу, пока на бирже они стоят дороже, — получилась бы вечная
 * бесплатная разница: купил у банка, продал на бирже, повторил. Настоящие
 * банки размещают допэмиссию по рыночной цене ровно поэтому.
 */
export async function tradeBankShares(
  playerId: string,
  quantity: number,
  marketPrice: number,
): Promise<BankResult<{ shares: number; price: number; total: number }>> {
  const bank = await getBank();
  const price = marketPrice > 0 ? marketPrice : bookValuePerShare(bank);
  const holding = await prisma.gameBankShare.findUnique({ where: { playerId } });
  const owned = holding?.shares ?? 0;

  if (quantity > 0) {
    // В казне ограниченное число акций: банк не печатает их бесконечно.
    const available = bank.totalShares - bank.sharesSold;
    if (quantity > available) return { ok: false, error: "sold_out" };
    const total = price * quantity;
    // ГЛАВНАЯ ПРОВЕРКА ЭТОЙ ФУНКЦИИ. Покупка раньше увеличивала капитал
    // банка безусловно — деньги за акции не откуда-то, а из воздуха. Продажа
    // того же пакета следующим вызовом превращала его в pendingPayout, то
    // есть buy→sell был печатным станком без единого шага, где хоть что-то
    // проверялось. Общая стоимость купленного (по цене входа, не текущей)
    // не может превышать эквити покупателя.
    const alreadyInvested = (holding?.avgPrice ?? 0) * owned;
    if (alreadyInvested + total > (await playerEquity(playerId))) return { ok: false, error: "too_small" };
    const avgPrice = owned > 0 ? ((holding?.avgPrice ?? 0) * owned + total) / (owned + quantity) : price;
    await prisma.$transaction([
      prisma.gameBankShare.upsert({
        where: { playerId },
        create: { playerId, shares: quantity, avgPrice: price },
        update: { shares: owned + quantity, avgPrice },
      }),
      prisma.gameBank.update({
        where: { id: bank.id },
        // Деньги за акции идут в капитал: это и есть выпуск акций.
        data: { sharesSold: { increment: quantity }, capital: { increment: total } },
      }),
    ]);
    return { ok: true, value: { shares: owned + quantity, price, total } };
  }

  const sell = Math.min(owned, -quantity);
  if (!(sell > 0)) return { ok: false, error: "too_small" };
  const total = price * sell;
  // Списываем бумаги ЗАЯВКОЙ: условие «их и правда столько» стоит в самом
  // апдейте. Без него два одновременных запроса на продажу всего пакета
  // проходили проверку оба — игрок получал деньги дважды, а капитал банка
  // уменьшался дважды за один и тот же пакет.
  const sold = await prisma.gameBankShare.updateMany({
    where: { playerId, shares: { gte: sell } },
    data: { shares: { decrement: sell } },
  });
  if (sold.count === 0) return { ok: false, error: "too_small" };
  await prisma.$transaction([
    prisma.gameBank.update({
      where: { id: bank.id },
      data: { sharesSold: { decrement: sell }, capital: { decrement: total } },
    }),
    prisma.gamePlayer.update({ where: { id: playerId }, data: { pendingPayout: { increment: total } } }),
  ]);
  return { ok: true, value: { shares: owned - sell, price, total } };
}

// ── Витрина изъятого ──────────────────────────────────────────────────────

export async function repossessedList() {
  const rows = await prisma.gameRepossessed.findMany({
    where: { soldAt: null },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return rows.map((row) => {
    const item = getShopItem(row.itemId);
    return {
      id: row.id,
      itemId: row.itemId,
      price: row.price,
      // Полная цена в магазине — чтобы видна была выгода.
      shopPrice: item?.price ?? row.price,
      createdAt: row.createdAt.getTime(),
    };
  });
}

/** Купить изъятую вещь. Деньги списывает клиент, сервер отдаёт предмет. */
export async function buyRepossessed(playerId: string, id: string): Promise<BankResult<{ itemId: string; price: number }>> {
  const row = await prisma.gameRepossessed.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "not_found" };
  if (row.soldAt) return { ok: false, error: "sold_out" };
  const bank = await getBank();

  // Заявка на покупку: вещь одна, покупателей может быть двое. Условие
  // «ещё не продана» стоит в самом апдейте — второй покупатель получит отказ,
  // а не ту же яхту и второй раз пополненный капитал банка.
  const bought = await prisma.gameRepossessed.updateMany({
    where: { id, soldAt: null },
    data: { soldToId: playerId, soldAt: new Date() },
  });
  if (bought.count === 0) return { ok: false, error: "sold_out" };
  // Выручка от продажи залога возвращается в капитал: именно ради неё банк
  // и берёт обеспечение.
  await prisma.gameBank.update({ where: { id: bank.id }, data: { capital: { increment: row.price } } });

  return { ok: true, value: { itemId: row.itemId, price: row.price } };
}

/** Сводка по банку для витрины. */
export async function bankSummary(playerId: string, equity: number, bankruptcies: number, now = Date.now()) {
  await collectOverdue(now);
  const bank = await getBank();
  const [file, loans, bonds, shares, repossessed] = await Promise.all([
    creditFile(playerId, equity, bankruptcies),
    prisma.gameBankLoan.findMany({ where: { playerId, status: "active" }, orderBy: { dueAt: "asc" } }),
    prisma.gameBankBond.findMany({ where: { playerId, redeemedAt: null }, orderBy: { maturesAt: "asc" } }),
    prisma.gameBankShare.findUnique({ where: { playerId } }),
    repossessedList(),
  ]);

  return {
    bank: {
      capital: bank.capital,
      lentOut: bank.lentOut,
      bondsIssued: bank.bondsIssued,
      interestEarned: bank.interestEarned,
      lossesTaken: bank.lossesTaken,
      capacity: lendingCapacity(bank),
      bookValuePerShare: bookValuePerShare(bank),
      sharesAvailable: bank.totalShares - bank.sharesSold,
      totalShares: bank.totalShares,
      foundedAt: bank.foundedAt.getTime(),
    },
    credit: file,
    loans: loans.map((loan) => ({
      id: loan.id,
      principal: loan.principal,
      ratePct: loan.ratePct,
      dueAt: loan.dueAt.getTime(),
      due: amountDue(loan, now),
      collateralItem: loan.collateralItem,
    })),
    bonds: bonds.map((bond) => ({
      id: bond.id,
      amount: bond.amount,
      couponPct: bond.couponPct,
      maturesAt: bond.maturesAt.getTime(),
      payout: bond.amount * (1 + (bond.couponPct / 100) * (bond.termDays / 365)),
      matured: bond.maturesAt.getTime() <= now,
    })),
    shares: { owned: shares?.shares ?? 0, avgPrice: shares?.avgPrice ?? 0 },
    repossessed,
    depositTerms: DEPOSIT_TERMS,
    depositRatePct: DEPOSIT_RATE_PCT,
    tickers: { share: BANK_SHARE_ASSET, bond: BANK_BOND_ASSET },
  };
}
