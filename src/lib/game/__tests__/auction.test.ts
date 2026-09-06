import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { placeBid, settleAuctions, AUCTION_DURATION_MS } from "@/lib/game/bank";

// Аукцион изъятого — раньше вещь продавалась за фиксированную цену первому
// нажавшему. Здесь проверяется то, ради чего его вообще заводили: выигрывает
// наибольшая ставка, проигравшие не платят, а ставка выше своей эквити не
// проходит — иначе она надувала бы капитал банка из воздуха, как и вклад в
// фонд до недавнего фикса.

async function makePlayer(nickname: string, equity: number) {
  return prisma.gamePlayer.create({ data: { nickname, equity } });
}

async function makeLot(price: number, endsInMs: number) {
  return prisma.gameRepossessed.create({
    data: { itemId: "life_car", price, auctionEndsAt: new Date(Date.now() + endsInMs) },
  });
}

describe("аукцион изъятого", () => {
  let poorId: string;
  let richId: string;
  let cleanupIds: string[] = [];

  beforeAll(async () => {
    const poor = await makePlayer(`Бедный-${Date.now()}-${Math.random()}`, 1_000);
    const rich = await makePlayer(`Богатый-${Date.now()}-${Math.random()}`, 1_000_000);
    poorId = poor.id;
    richId = rich.id;
    cleanupIds = [poorId, richId];
  });

  afterAll(async () => {
    await prisma.gamePlayer.deleteMany({ where: { id: { in: cleanupIds } } });
  });

  it("ставка ниже резерва отклоняется", async () => {
    const lot = await makeLot(1_000, AUCTION_DURATION_MS);
    const bid = await placeBid(richId, lot.id, 500);
    expect(bid.ok).toBe(false);
    if (!bid.ok) expect(bid.error).toBe("bid_too_low");
    await prisma.gameRepossessed.delete({ where: { id: lot.id } });
  });

  it("ставка выше своей эквити отклоняется — иначе капитал банка растёт из воздуха", async () => {
    const lot = await makeLot(500, AUCTION_DURATION_MS);
    const bid = await placeBid(poorId, lot.id, 5_000);
    expect(bid.ok).toBe(false);
    if (!bid.ok) expect(bid.error).toBe("too_small");
    await prisma.gameRepossessed.delete({ where: { id: lot.id } });
  });

  it("вторая ставка ниже текущей отклоняется, шаг проверяется по минимуму", async () => {
    const lot = await makeLot(500, AUCTION_DURATION_MS);
    const first = await placeBid(poorId, lot.id, 500);
    expect(first.ok).toBe(true);
    const tooClose = await placeBid(richId, lot.id, 510); // меньше минимального шага
    expect(tooClose.ok).toBe(false);
    const higher = await placeBid(richId, lot.id, first.ok ? first.value.minNextBid : 0);
    expect(higher.ok).toBe(true);
    await prisma.gameRepossessed.delete({ where: { id: lot.id } });
  });

  it("после срока побеждает наибольшая ставка, деньги идут в капитал банка, вещь — победителю", async () => {
    // Полный срок на старте: другие тестовые файлы делят с этим ту же БД и
    // сами дёргают settleAuctions (например через bankSummary) в реальном
    // времени — лот, истекающий через 10 мс, рисковал закрыться чужим
    // вызовом МЕЖДУ двумя ставками, отдав победу тому, кто просто успел
    // поставить первым. В прошлое срок переводим только когда обе ставки
    // уже сделаны.
    const lot = await makeLot(500, AUCTION_DURATION_MS);
    await placeBid(poorId, lot.id, 500);
    await placeBid(richId, lot.id, 800);
    await prisma.gameRepossessed.update({ where: { id: lot.id }, data: { auctionEndsAt: new Date(Date.now() - 1000) } });

    const bankBefore = await prisma.gameBank.findFirst();
    // Не абсолютное число — в базе могли остаться просроченные лоты от
    // прежних прогонов; важно, что НАШ лот закрылся и закрылся верно.
    await settleAuctions();

    const row = await prisma.gameRepossessed.findUnique({ where: { id: lot.id } });
    expect(row?.soldToId).toBe(richId);
    expect(row?.soldAt).not.toBeNull();

    const bankAfter = await prisma.gameBank.findFirst();
    expect(bankAfter!.capital - bankBefore!.capital).toBeCloseTo(800, 5);

    const winner = await prisma.gamePlayer.findUnique({ where: { id: richId }, select: { wonItems: true } });
    expect(JSON.parse(winner!.wonItems!)).toContain("life_car");

    const loser = await prisma.gamePlayer.findUnique({ where: { id: poorId }, select: { wonItems: true } });
    expect(loser?.wonItems ?? null).toBeNull();
  });

  it("лот без единой ставки не пропадает — уходит на новый круг", async () => {
    const lot = await makeLot(500, 10);
    const settled = await settleAuctions(Date.now() + 20);
    // Могли попасться и другие просроченные лоты из прошлых тестов — считаем
    // не абсолютное число, а то, что ИМЕННО этот лот остался в игре.
    void settled;
    const row = await prisma.gameRepossessed.findUnique({ where: { id: lot.id } });
    expect(row?.soldAt).toBeNull();
    expect(row!.auctionEndsAt.getTime()).toBeGreaterThan(Date.now());
    await prisma.gameRepossessed.delete({ where: { id: lot.id } });
  });

  it("ставка на закрытый аукцион отклоняется", async () => {
    const lot = await makeLot(500, 10);
    await settleAuctions(Date.now() + 20); // без ставок — уйдёт на новый круг с продлённым сроком
    // Форсируем срок в прошлое напрямую, минуя обычный путь, чтобы
    // проверить именно отказ по времени, а не по факту продажи.
    await prisma.gameRepossessed.update({ where: { id: lot.id }, data: { auctionEndsAt: new Date(Date.now() - 1000) } });
    const bid = await placeBid(richId, lot.id, 500);
    expect(bid.ok).toBe(false);
    if (!bid.ok) expect(bid.error).toBe("auction_over");
    await prisma.gameRepossessed.delete({ where: { id: lot.id } });
  });
});
