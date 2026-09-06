import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  BANK_SLOTS,
  CHARTER,
  bondTicker,
  charterRequirements,
  foundBank,
  issuePaper,
  myBank,
} from "@/lib/game/userBank";
import { allListings } from "@/lib/game/listing";
import assetsData from "@/data/assets.json";

// Банк игрока — эмитент: его акция и облигация появляются на бирже. Здесь
// проверяется то, ради чего требования вообще заводились (лицензию не должно
// быть легко получить) и то, что размещение не печатает деньги: выручка
// приходит в капитал, а облигация одновременно становится ДОЛГОМ.

function nick(tag: string) {
  return `${tag}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

/** Игрок, у которого выполнено всё, кроме явно ослабленного условия. */
async function makeReadyPlayer(over: Partial<{ equity: number; prestige: number; reliability: number }> = {}) {
  return prisma.gamePlayer.create({
    data: {
      nickname: nick("Банкир"),
      equity: over.equity ?? CHARTER.deposit * 2,
      prestige: over.prestige ?? CHARTER.prestige,
      contractsPassed: CHARTER.contracts,
      reliability: over.reliability ?? CHARTER.reliability,
      createdAt: new Date(Date.now() - (CHARTER.ageDays + 1) * 24 * 60 * 60 * 1000),
    },
  });
}

describe("тикер облигации", () => {
  it("выводится из тикера акции и укладывается в пять букв", () => {
    expect(bondTicker("ABC")).toBe("ABCB");
    expect(bondTicker("ABCDE")).toBe("ABCDB");
    expect(bondTicker("ABCDE").length).toBeLessThanOrEqual(5);
  });
});

describe("слоты под банки", () => {
  it("каждый слот есть в справочнике: без него у бумаги не будет цены", () => {
    const ids = new Set((assetsData as { id: string }[]).map((a) => a.id));
    for (const pair of BANK_SLOTS) {
      expect(ids.has(pair.share)).toBe(true);
      expect(ids.has(pair.bond)).toBe(true);
    }
  });

  it("облигация спокойнее акции — иначе она не облигация", () => {
    const assets = assetsData as { id: string; baseVolatility: number }[];
    const share = assets.find((a) => a.id === BANK_SLOTS[0].share)!;
    const bond = assets.find((a) => a.id === BANK_SLOTS[0].bond)!;
    expect(bond.baseVolatility).toBeLessThan(share.baseVolatility);
  });
});

describe("лицензия", () => {
  const cleanup: string[] = [];

  afterAll(async () => {
    await prisma.gamePlayer.deleteMany({ where: { id: { in: cleanup } } });
  });

  it("новичку не выдаётся: стаж и престиж не покупаются", async () => {
    const player = await prisma.gamePlayer.create({
      data: { nickname: nick("Новичок"), equity: CHARTER.deposit * 10 },
    });
    cleanup.push(player.id);

    const req = await charterRequirements(player.id);
    expect(req?.meets.deposit).toBe(true);
    expect(req?.meets.age).toBe(false);
    expect(req?.meets.prestige).toBe(false);
    expect(req?.ready).toBe(false);

    const result = await foundBank(player.id, "Банк новичка", "NOOB");
    expect(result).toEqual({ ok: false, error: "not_ready" });
  });

  it("денег хватает, но есть просрочки — отказ", async () => {
    const player = await makeReadyPlayer({ reliability: CHARTER.reliability - 20 });
    cleanup.push(player.id);
    const result = await foundBank(player.id, "Должник и партнёры", "DEBT");
    expect(result).toEqual({ ok: false, error: "not_ready" });
  });

  it("эквити ниже взноса — отказ: взнос платится реальными деньгами", async () => {
    const player = await makeReadyPlayer({ equity: CHARTER.deposit - 1 });
    cleanup.push(player.id);
    const result = await foundBank(player.id, "Пустой карман", "POOR");
    expect(result).toEqual({ ok: false, error: "not_ready" });
  });
});

describe("учреждённый банк", () => {
  let playerId: string;
  let bankId: string | null = null;
  const ticker = `Z${Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z]/g, "X")}`;

  beforeAll(async () => {
    const player = await makeReadyPlayer();
    playerId = player.id;
  });

  afterAll(async () => {
    if (bankId) await prisma.gameUserBank.deleteMany({ where: { id: bankId } });
    await prisma.gamePlayer.deleteMany({ where: { id: playerId } });
  });

  it("выдаёт две бумаги и обе попадают на биржу", async () => {
    const result = await foundBank(playerId, "Северный банк", ticker, "Проценты идут за нами");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bank = await myBank(playerId);
    bankId = bank?.id ?? null;
    expect(bank?.papers.map((p) => p.kind).sort()).toEqual(["bank_bond", "bank_share"]);

    const board = await allListings();
    const mine = board.filter((row) => row.bankId === bankId);
    expect(mine).toHaveLength(2);
    // Ряд общий с фондами: терминал переименовывает слот по тикеру и имени.
    expect(mine.map((row) => row.ticker).sort()).toEqual([bondTicker(ticker), ticker].sort());
  });

  it("второй банк тому же игроку не выдаётся", async () => {
    const second = await foundBank(playerId, "Южный банк", "SOUT");
    expect(second).toEqual({ ok: false, error: "already_owner" });
  });

  it("размещение акции приносит выручку в капитал", async () => {
    const before = (await myBank(playerId))!;
    const result = await issuePaper(playerId, "bank_share", 1_000, 10);
    expect(result).toEqual({ ok: true, value: { sold: 1_000, total: 10_000 } });
    const after = (await myBank(playerId))!;
    expect(after.capital - before.capital).toBeCloseTo(10_000, 6);
    // Акция — не заём: долг от неё расти не должен.
    expect(after.bondsIssued).toBeCloseTo(before.bondsIssued, 6);
  });

  it("размещение облигации — это ДОЛГ, а не собственные средства", async () => {
    const before = (await myBank(playerId))!;
    const result = await issuePaper(playerId, "bank_bond", 500, 20);
    expect(result.ok).toBe(true);
    const after = (await myBank(playerId))!;
    expect(after.capital - before.capital).toBeCloseTo(10_000, 6);
    expect(after.bondsIssued - before.bondsIssued).toBeCloseTo(10_000, 6);

    // Балансовая стоимость акции считается ЗА ВЫЧЕТОМ долга: иначе заём
    // выглядел бы прибавкой к собственным средствам, и облигацию имело бы
    // смысл выпускать бесконечно.
    const row = (await allListings()).find((r) => r.bankId === after.id && r.kind === "bank_share")!;
    expect(row.capital).toBeCloseTo(after.capital - after.bondsIssued, 6);
  });

  it("больше выпуска не разместить: бумага не берётся из воздуха", async () => {
    const bank = (await myBank(playerId))!;
    const share = bank.papers.find((p) => p.kind === "bank_share")!;
    const result = await issuePaper(playerId, "bank_share", share.total * 2, 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sold).toBeCloseTo(share.total - share.sold, 6);
    const after = (await myBank(playerId))!;
    expect(after.papers.find((p) => p.kind === "bank_share")!.sold).toBeCloseTo(share.total, 6);
    expect((await issuePaper(playerId, "bank_share", 1, 1))).toEqual({ ok: false, error: "nothing_left" });
  });
});
