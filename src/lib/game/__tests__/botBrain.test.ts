import { describe, it, expect } from "vitest";
import {
  botEquity,
  decideByRules,
  marketBrief,
  MAX_POSITIONS,
  parseDecision,
  positionPnlPct,
  positionValue,
  STOP_LOSS_PCT,
  TAKE_PROFIT_PCT,
  type BotPositionView,
  type BotSettings,
} from "@/lib/game/botBrain";

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function position(over: Partial<BotPositionView> = {}): BotPositionView {
  return { id: "p1", assetId: "STK_NEXTEK", side: "long", qty: 10, entryPrice: 100, openedAt: NOW, ...over };
}

function settings(over: Partial<BotSettings> = {}): BotSettings {
  return { skill: 0.7, risk: 1, aiPct: 0, style: "day", ...over };
}

describe("счёт бота", () => {
  it("лонг стоит столько, сколько за него дают", () => {
    expect(positionValue(position(), 120)).toBe(1_200);
  });

  it("шорт приносит результат, а не стоимость бумаги", () => {
    // Выручка от продажи уже лежит в кэше, поэтому у шорта считается только
    // разница — иначе счёт удваивался бы на ровном месте.
    expect(positionValue(position({ side: "short" }), 90)).toBe(100);
    expect(positionValue(position({ side: "short" }), 110)).toBe(-100);
  });

  it("результат в процентах у шорта зеркальный", () => {
    expect(positionPnlPct(position(), 110)).toBeCloseTo(10);
    expect(positionPnlPct(position({ side: "short" }), 110)).toBeCloseTo(-10);
  });

  it("эквити не меняется в момент открытия лонга", () => {
    // Деньги ушли в бумагу — счёт остался тем же.
    const quotes = { STK_NEXTEK: { price: 100, dayChangePct: 0 } };
    expect(botEquity(9_000, [position()], quotes)).toBe(10_000);
  });

  it("позиция без котировки счёт не ломает", () => {
    expect(botEquity(500, [position({ assetId: "GONE" })], {})).toBe(500);
  });
});

describe("решения по правилам", () => {
  const quotes = {
    STK_NEXTEK: { price: 100, dayChangePct: 2 },
    CRY_KRYPTON: { price: 50, dayChangePct: 0.05 },
  };
  const watched = ["STK_NEXTEK", "CRY_KRYPTON"];

  it("стоп закрывает позицию раньше любых новых идей", () => {
    const losing = position({ entryPrice: 100 });
    const decision = decideByRules(settings(), [losing], { STK_NEXTEK: { price: 100 - STOP_LOSS_PCT - 1, dayChangePct: -9 } }, watched, 0, NOW);
    expect(decision).toEqual({ action: "close", positionId: "p1", reason: "стоп" });
  });

  it("прибыль фиксируется на тейке", () => {
    const winning = position({ entryPrice: 100 });
    const decision = decideByRules(settings(), [winning], { STK_NEXTEK: { price: 100 + TAKE_PROFIT_PCT + 1, dayChangePct: 13 } }, watched, 0, NOW);
    expect(decision.action).toBe("close");
  });

  it("идея, не сработавшая за срок стиля, закрывается по времени", () => {
    const stale = position({ openedAt: NOW - 5 * HOUR });
    const decision = decideByRules(settings({ style: "scalping" }), [stale], quotes, watched, 0, NOW);
    expect(decision).toMatchObject({ action: "close", positionId: "p1" });
  });

  it("больше четырёх позиций бот не набирает", () => {
    // Цены входа совпадают с рынком: иначе сработал бы стоп, и до правила
    // «позиций достаточно» дело бы не дошло.
    const many = Array.from({ length: MAX_POSITIONS }, (_, i) => {
      const assetId = watched[i % watched.length];
      return position({ id: `p${i}`, assetId, entryPrice: quotes[assetId as keyof typeof quotes].price });
    });
    const decision = decideByRules(settings(), many, quotes, watched, 0, NOW);
    expect(decision.action).toBe("hold");
  });

  it("на стоящем рынке бот не лезет в сделку", () => {
    const flat = { STK_NEXTEK: { price: 100, dayChangePct: 0.01 }, CRY_KRYPTON: { price: 50, dayChangePct: 0 } };
    expect(decideByRules(settings(), [], flat, watched, 0, NOW).action).toBe("hold");
  });

  it("дейтрейдер идёт за движением, а инвестор против него", () => {
    const day = decideByRules(settings({ style: "day" }), [], quotes, watched, 0, NOW);
    const investor = decideByRules(settings({ style: "investing" }), [], quotes, watched, 0, NOW);
    expect(day).toMatchObject({ action: "open", assetId: "STK_NEXTEK", side: "long" });
    expect(investor).toMatchObject({ action: "open", side: "short" });
  });

  it("слабый бот регулярно встаёт не в ту сторону", () => {
    // luck выше мастерства — решение переворачивается: именно поэтому счёт
    // слабого бота тает и на растущем рынке.
    const weak = decideByRules(settings({ skill: 0.2 }), [], quotes, watched, 0.9, NOW);
    expect(weak).toMatchObject({ action: "open", side: "short" });
  });

  it("стремление задаёт размер позиции, но не выше потолка", () => {
    const greedy = decideByRules(settings({ risk: 10 }), [], quotes, watched, 0, NOW);
    expect(greedy).toMatchObject({ action: "open" });
    if (greedy.action === "open") expect(greedy.sizePct).toBeLessThanOrEqual(60);
    const shy = decideByRules(settings({ risk: 0.01 }), [], quotes, watched, 0, NOW);
    if (shy.action === "open") expect(shy.sizePct).toBeGreaterThanOrEqual(5);
  });
});

describe("ответ модели", () => {
  const bySymbol = { NXTK: "STK_NEXTEK" };
  const positions = [position({ id: "abc" })];

  it("разбирается даже в обрамлении из текста и заборов", () => {
    const raw = 'Вот моё решение:\n```json\n{"action":"open","symbol":"NXTK","side":"long","sizePct":20,"reason":"пробой"}\n```';
    expect(parseDecision(raw, [], bySymbol)).toEqual({
      action: "open",
      assetId: "STK_NEXTEK",
      side: "long",
      sizePct: 20,
      reason: "пробой",
    });
  });

  it("buy и sell понимаются как сторона сделки", () => {
    const sell = parseDecision('{"action":"sell","symbol":"NXTK","reason":"перегрето"}', [], bySymbol);
    expect(sell).toMatchObject({ action: "open", side: "short" });
  });

  it("выдуманный моделью инструмент отбрасывается", () => {
    expect(parseDecision('{"action":"open","symbol":"AAPL","side":"long"}', [], bySymbol)).toBeNull();
  });

  it("закрытие несуществующей позиции отбрасывается", () => {
    expect(parseDecision('{"action":"close","symbol":"NXTK"}', [], bySymbol)).toBeNull();
    expect(parseDecision('{"action":"close","symbol":"NXTK"}', positions, bySymbol)).toMatchObject({
      action: "close",
      positionId: "abc",
    });
  });

  it("размер зажимается в разумные рамки", () => {
    const huge = parseDecision('{"action":"open","symbol":"NXTK","side":"long","sizePct":500}', [], bySymbol);
    if (huge?.action === "open") expect(huge.sizePct).toBe(60);
  });

  it("мусор вместо JSON — не решение", () => {
    expect(parseDecision("не могу ответить", [], bySymbol)).toBeNull();
    expect(parseDecision("{сломано}", [], bySymbol)).toBeNull();
  });
});

describe("сводка для модели", () => {
  it("показывает котировки, позиции с результатом и заголовки", () => {
    const brief = marketBrief(
      ["STK_NEXTEK"],
      { STK_NEXTEK: { price: 110, dayChangePct: 1.5 } },
      () => "NXTK",
      [position()],
      [{ headline: "Отчёт лучше ожиданий" }],
    );
    expect(brief).toContain("NXTK 110.00 (+1.50% за день)");
    expect(brief).toContain("лонг от 100.00 (+10.0%)");
    expect(brief).toContain("Отчёт лучше ожиданий");
  });

  it("про пустой портфель говорит прямо", () => {
    expect(marketBrief([], {}, () => "X", [], [])).toContain("Открытых позиций нет");
  });
});
