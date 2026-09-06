import { describe, it, expect, vi } from "vitest";
import { decideCentralBank, botMandate } from "@/lib/game/bots";
import type { BotPositionView } from "@/lib/game/botBrain";
import { CENTRAL_BANK_ASSET_ID } from "@/lib/game/marketMovers";

// Сценарии — то, что теперь редактирует админ (AiScenarios.tsx) вместо
// правки кода. Важно, что подстановка не ломается на пустых значениях и что
// у центробанка ВСЕГДА есть детерминированный откат, даже когда модель
// недоступна или ответила чем-то, что не разобрать.

vi.mock("@/lib/featureConfig", () => ({
  getFeatureConfig: vi.fn(async () => ({
    aiScenarios: {
      regular: "Ты — {{nickname}}, стиль {{style}}.",
      central_bank: "Центробанк. {{context}}",
      hedge_fund: "{{nickname}}: {{context}}",
      market_maker: "{{nickname}}: {{context}}",
    },
  })),
}));

describe("мандат бота — подстановка переменных", () => {
  it("подставляет известные переменные", async () => {
    const text = await botMandate("regular", { nickname: "Гоша", style: "swing" });
    expect(text).toBe("Ты — Гоша, стиль swing.");
  });

  it("роль без своего сценария падает на regular", async () => {
    const text = await botMandate("unknown_role", { nickname: "Х", style: "day" });
    expect(text).toBe("Ты — Х, стиль day.");
  });

  it("отсутствующая переменная схлопывается в пустую строку, а не в {{ключ}}", async () => {
    const text = await botMandate("central_bank", {});
    expect(text).toBe("Центробанк. ");
    expect(text).not.toContain("{{");
  });
});

describe("решение центробанка — детерминированный откат", () => {
  const quotes = { [CENTRAL_BANK_ASSET_ID]: { price: 100, dayChangePct: 0 } };

  it("кризис без позиции — открывает лонг", () => {
    const decision = decideCentralBank([], quotes, "crisis");
    expect(decision.action).toBe("open");
    if (decision.action === "open") {
      expect(decision.assetId).toBe(CENTRAL_BANK_ASSET_ID);
      expect(decision.side).toBe("long");
    }
  });

  it("боковик с открытой позицией — закрывает: политика больше не нужна", () => {
    const position: BotPositionView = {
      id: "p1",
      assetId: CENTRAL_BANK_ASSET_ID,
      side: "long",
      qty: 1,
      entryPrice: 100,
      openedAt: Date.now(),
    };
    const decision = decideCentralBank([position], quotes, "sideways");
    expect(decision.action).toBe("close");
  });

  it("позиция уже соответствует политике — держит, не дёргает счёт зря", () => {
    const position: BotPositionView = {
      id: "p1",
      assetId: CENTRAL_BANK_ASSET_ID,
      side: "long",
      qty: 1,
      entryPrice: 100,
      openedAt: Date.now(),
    };
    const decision = decideCentralBank([position], quotes, "crisis");
    expect(decision.action).toBe("hold");
  });
});
