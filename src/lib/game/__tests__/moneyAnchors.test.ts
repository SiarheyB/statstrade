import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { offerLoan, cancelLoan } from "@/lib/game/loans";
import { buyBond, tradeBankShares, getBank } from "@/lib/game/bank";
import { depositToFund, createFund } from "@/lib/game/funds";

// Четыре печатных станка, найденных при живом аудите (не в отчёте — их
// пропустили: этих функций не касался ни один тест). Общая форма одна и та
// же: сумма принималась из запроса без единой проверки и безусловно
// увеличивала ОБЩЕЕ состояние (капитал банка, капитал фонда), а обратная
// операция (отмена займа, погашение облигации, продажа акций, выплата фонда)
// превращала её в pendingPayout — реальные, переживающие устройство деньги —
// без единого игрока по другую сторону сделки.
//
// Тесты идут по живой БД (docker), а не по мокам: мокать пришлось бы шесть
// таблиц ради одной проверки, а сама проверка — устойчивость денег к
// перечитыванию эквити из базы, что на моках не отличить от подделки.

async function makePlayer(nickname: string, equity: number) {
  return prisma.gamePlayer.create({ data: { nickname, equity } });
}

describe("деньги не создаются без связи с эквити", () => {
  let poorId: string;
  let richId: string;

  beforeAll(async () => {
    const poor = await makePlayer(`Бедный-${Date.now()}`, 1_000);
    const rich = await makePlayer(`Богатый-${Date.now()}`, 10_000_000);
    poorId = poor.id;
    richId = rich.id;
  });

  afterAll(async () => {
    await prisma.gamePlayer.deleteMany({ where: { id: { in: [poorId, richId] } } });
  });

  it("предложить в долг больше своей эквити нельзя — раньше offer+cancel печатал деньги за один шаг", async () => {
    const before = await prisma.gamePlayer.findUnique({ where: { id: poorId }, select: { pendingPayout: true } });
    const offer = await offerLoan(poorId, "Бедный", 500_000, 10, 7);
    expect(offer.ok).toBe(false);
    if (!offer.ok) expect(offer.error).toBe("invalid_amount");

    // В пределах своей эквити — предложение проходит, и цикл offer→cancel
    // возвращает РОВНО ту же сумму, которую сам же и заявил, не больше.
    const small = await offerLoan(poorId, "Бедный", 500, 10, 7);
    expect(small.ok).toBe(true);
    if (small.ok) {
      const cancelled = await cancelLoan(poorId, small.value.id);
      expect(cancelled.ok).toBe(true);
    }
    const after = await prisma.gamePlayer.findUnique({ where: { id: poorId }, select: { pendingPayout: true } });
    expect(after!.pendingPayout - (before?.pendingPayout ?? 0)).toBeLessThanOrEqual(500);
  });

  it("богатый может предложить сумму, недоступную бедному — проверка тянет реальную эквити, а не константу", async () => {
    const offer = await offerLoan(richId, "Богатый", 500_000, 10, 7);
    expect(offer.ok).toBe(true);
    if (offer.ok) await cancelLoan(richId, offer.value.id);
  });

  it("облигация не даёт купить больше своей эквити — иначе купон обналичивался бы из воздуха через дни", async () => {
    const bond = await buyBond(poorId, 500_000, 7);
    expect(bond.ok).toBe(false);
    if (!bond.ok) expect(bond.error).toBe("too_small");
  });

  it("акции банка: раунд-трип buy→sell без денег невозможен", async () => {
    const bank = await getBank();
    const bought = await tradeBankShares(poorId, 1000, bank.capital / bank.totalShares);
    // 1000 акций по книжной цене банка почти наверняка дороже 1000 у бедного.
    expect(bought.ok).toBe(false);

    // Купить на сумму в пределах своей эквити — можно; продать НАЗАД —
    // получаешь ровно то, что вложил, не более (без прибыли из ничего).
    const price = bank.capital / bank.totalShares;
    const affordable = Math.max(1, Math.floor(900 / price));
    const okBuy = await tradeBankShares(poorId, affordable, price);
    expect(okBuy.ok).toBe(true);
    if (okBuy.ok) {
      const before = await prisma.gamePlayer.findUnique({ where: { id: poorId }, select: { pendingPayout: true } });
      const sold = await tradeBankShares(poorId, -affordable, price);
      expect(sold.ok).toBe(true);
      const after = await prisma.gamePlayer.findUnique({ where: { id: poorId }, select: { pendingPayout: true } });
      // Продажа по той же цене — деньги вернулись, а не удвоились.
      expect((after!.pendingPayout - (before?.pendingPayout ?? 0)).toFixed(2)).toBe(
        (affordable * price).toFixed(2),
      );
    }
  });

  it("вклад в фонд не может превышать эквити вкладчика — иначе payoutFund отмывал бы его в pendingPayout", async () => {
    const fund = await createFund(richId, "Богатый", 100, null, `Тестовый фонд ${Date.now()}`, "", 0);
    expect(fund.ok).toBe(true);
    if (!fund.ok) return;
    const tooMuch = await depositToFund(poorId, fund.value.id, 500_000);
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.error).toBe("invalid_amount");
    await prisma.gameFund.deleteMany({ where: { id: fund.value.id } });
  });
});
