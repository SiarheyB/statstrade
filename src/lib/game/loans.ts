// Биржа займов между игроками.
//
// Как это работает и почему так. Деньги игрока живут в его браузере, сервер
// их не хранит — значит «перевести» их напрямую нельзя. Поэтому заём
// оформлен как ОБЯЗАТЕЛЬСТВО, которое ведёт сервер, а движение денег каждая
// сторона применяет у себя:
//
//   • кредитор публикует предложение — его клиент СРАЗУ списывает сумму
//     (деньги «ушли на биржу», иначе можно было бы обещать один и тот же
//     миллион десяти игрокам);
//   • заёмщик берёт заём — его клиент зачисляет сумму;
//   • заёмщик возвращает с процентом — его клиент списывает, а сервер кладёт
//     сумму в pendingPayout кредитора, и тот забирает её при следующей
//     синхронизации;
//   • просрочил — заём помечается дефолтом, репутация падает, событие уходит
//     в ленту мира. Деньги кредитору при дефолте не возвращаются: риск
//     невозврата и есть плата за процент.
//
// Отмена предложения возвращает сумму кредитору тем же способом — через
// pendingPayout.
import { prisma } from "@/lib/db";
import { recordEvent } from "@/lib/game/world";

export const MIN_LOAN = 100;
export const MAX_LOAN = 5_000_000;
export const MAX_INTEREST_PCT = 50;
export const MAX_TERM_DAYS = 180;
export const MIN_RELIABILITY_TO_BORROW = 40;
export const DEFAULT_RELIABILITY_PENALTY = 30;
export const REPAY_RELIABILITY_BONUS = 5;

/**
 * Сколько игрок может взять в долг суммарно. Привязано к его эквити (по
 * последней синхронизации), репутации и перкам «Связи»/«Кредитная линия»:
 * иначе новичок с тысячей на счету занимал бы миллион и уходил в закат.
 */
export function creditLimit(equity: number, reliability: number, perkBonus: number): number {
  const base = Math.max(1_000, equity * 0.5);
  const trust = Math.max(0, Math.min(1, reliability / 100));
  return Math.round(base * trust * (1 + perkBonus));
}

export type LoanError =
  | "invalid_amount"
  | "invalid_interest"
  | "invalid_term"
  | "not_found"
  | "not_yours"
  | "already_taken"
  | "own_loan"
  | "limit_exceeded"
  | "low_reliability"
  | "not_active";

export type LoanResult<T> = { ok: true; value: T } | { ok: false; error: LoanError };

export async function offerLoan(
  lenderId: string,
  lenderNickname: string,
  amount: number,
  interestPct: number,
  termDays: number,
): Promise<LoanResult<{ id: string }>> {
  if (!(amount >= MIN_LOAN) || amount > MAX_LOAN) return { ok: false, error: "invalid_amount" };
  if (!(interestPct >= 0) || interestPct > MAX_INTEREST_PCT) return { ok: false, error: "invalid_interest" };
  if (!(termDays >= 1) || termDays > MAX_TERM_DAYS) return { ok: false, error: "invalid_term" };

  const loan = await prisma.gameLoan.create({
    data: {
      lenderId,
      // Пока предложение не взято, заёмщик неизвестен. Схема требует
      // borrowerId, поэтому до сделки он равен кредитору — а фильтр
      // status="offered" не даёт спутать это с реальным долгом.
      borrowerId: lenderId,
      amount,
      interestPct,
      dueGameDay: termDays, // до выдачи здесь лежит СРОК, а не день: игровой день заёмщика ещё не известен
      status: "offered",
    },
  });
  await recordEvent(lenderId, "loan_offered", { nickname: lenderNickname, amount, interestPct, termDays });
  return { ok: true, value: { id: loan.id } };
}

export async function cancelLoan(lenderId: string, loanId: string): Promise<LoanResult<{ refund: number }>> {
  const loan = await prisma.gameLoan.findUnique({ where: { id: loanId } });
  if (!loan) return { ok: false, error: "not_found" };
  if (loan.lenderId !== lenderId) return { ok: false, error: "not_yours" };
  if (loan.status !== "offered") return { ok: false, error: "already_taken" };
  await prisma.$transaction([
    prisma.gameLoan.delete({ where: { id: loanId } }),
    prisma.gamePlayer.update({ where: { id: lenderId }, data: { pendingPayout: { increment: loan.amount } } }),
  ]);
  return { ok: true, value: { refund: loan.amount } };
}

export async function takeLoan(
  borrowerId: string,
  borrowerNickname: string,
  loanId: string,
  borrowerGameDay: number,
  equity: number,
  reliability: number,
  perkBonus: number,
): Promise<LoanResult<{ amount: number; dueGameDay: number }>> {
  const loan = await prisma.gameLoan.findUnique({ where: { id: loanId } });
  if (!loan) return { ok: false, error: "not_found" };
  if (loan.status !== "offered") return { ok: false, error: "already_taken" };
  if (loan.lenderId === borrowerId) return { ok: false, error: "own_loan" };
  if (reliability < MIN_RELIABILITY_TO_BORROW) return { ok: false, error: "low_reliability" };

  const active = await prisma.gameLoan.aggregate({
    where: { borrowerId, status: "active" },
    _sum: { amount: true },
  });
  const alreadyOwed = active._sum.amount ?? 0;
  if (alreadyOwed + loan.amount > creditLimit(equity, reliability, perkBonus)) {
    return { ok: false, error: "limit_exceeded" };
  }

  const dueGameDay = borrowerGameDay + loan.dueGameDay;
  await prisma.gameLoan.update({
    where: { id: loanId },
    data: { borrowerId, status: "active", takenAt: new Date(), dueGameDay },
  });
  await recordEvent(borrowerId, "loan_taken", { nickname: borrowerNickname, amount: loan.amount });
  return { ok: true, value: { amount: loan.amount, dueGameDay } };
}

/** Сколько нужно вернуть по займу. */
export function repayAmount(amount: number, interestPct: number): number {
  return Math.round(amount * (1 + interestPct / 100) * 100) / 100;
}

export async function repayLoan(
  borrowerId: string,
  borrowerNickname: string,
  loanId: string,
): Promise<LoanResult<{ paid: number }>> {
  const loan = await prisma.gameLoan.findUnique({ where: { id: loanId } });
  if (!loan) return { ok: false, error: "not_found" };
  if (loan.borrowerId !== borrowerId) return { ok: false, error: "not_yours" };
  if (loan.status !== "active") return { ok: false, error: "not_active" };

  const paid = repayAmount(loan.amount, loan.interestPct);
  await prisma.$transaction([
    prisma.gameLoan.update({ where: { id: loanId }, data: { status: "repaid", repaidAt: new Date() } }),
    // Кредитору деньги приходят не «на сервер», а в очередь на получение:
    // он заберёт их в игру при следующей синхронизации.
    ...(loan.lenderId
      ? [
          prisma.gamePlayer.update({
            where: { id: loan.lenderId },
            data: { pendingPayout: { increment: paid } },
          }),
        ]
      : []),
    prisma.gamePlayer.update({
      where: { id: borrowerId },
      data: { reliability: { increment: REPAY_RELIABILITY_BONUS } },
    }),
  ]);
  // Репутация не должна уползти выше 100 инкрементом — подрезаем отдельно.
  await prisma.gamePlayer.updateMany({ where: { id: borrowerId, reliability: { gt: 100 } }, data: { reliability: 100 } });
  await recordEvent(borrowerId, "loan_repaid", { nickname: borrowerNickname, amount: paid });
  return { ok: true, value: { paid } };
}

/**
 * Помечает просроченные займы игрока. Вызывается на каждой синхронизации:
 * срок считается в ИГРОВЫХ днях заёмщика, а их знает только его клиент.
 */
export async function markOverdue(borrowerId: string, nickname: string, currentGameDay: number): Promise<number> {
  const overdue = await prisma.gameLoan.findMany({
    where: { borrowerId, status: "active", dueGameDay: { lt: currentGameDay } },
    select: { id: true, amount: true },
  });
  if (overdue.length === 0) return 0;
  await prisma.gameLoan.updateMany({
    where: { id: { in: overdue.map((l) => l.id) } },
    data: { status: "defaulted" },
  });
  await prisma.gamePlayer.update({
    where: { id: borrowerId },
    data: { reliability: { decrement: DEFAULT_RELIABILITY_PENALTY * overdue.length } },
  });
  await prisma.gamePlayer.updateMany({ where: { id: borrowerId, reliability: { lt: 0 } }, data: { reliability: 0 } });
  for (const loan of overdue) {
    await recordEvent(borrowerId, "loan_defaulted", { nickname, amount: loan.amount });
  }
  return overdue.length;
}

export async function loanBoard(playerId: string) {
  const [offers, mine, given] = await Promise.all([
    prisma.gameLoan.findMany({
      where: { status: "offered" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        amount: true,
        interestPct: true,
        dueGameDay: true,
        createdAt: true,
        lender: { select: { id: true, nickname: true, reliability: true } },
      },
    }),
    prisma.gameLoan.findMany({
      where: { borrowerId: playerId, status: { in: ["active", "defaulted"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        amount: true,
        interestPct: true,
        dueGameDay: true,
        status: true,
        lender: { select: { nickname: true } },
      },
    }),
    prisma.gameLoan.findMany({
      where: { lenderId: playerId, status: { in: ["offered", "active", "defaulted"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        amount: true,
        interestPct: true,
        dueGameDay: true,
        status: true,
        borrower: { select: { nickname: true } },
      },
    }),
  ]);
  // В предложениях borrower === lender (см. offerLoan) — чтобы UI не показал
  // «сам себе должен», из выдачи он просто исключён.
  return { offers, mine, given };
}
