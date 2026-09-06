import { describe, it, expect } from "vitest";
import { botLoopDisabled, FIRST_TICK_DELAY_MS } from "@/lib/game/botLoop";
import { BOT_TICK_MS } from "@/lib/game/bots";

describe("цикл жизни ботов", () => {
  it("по умолчанию включён: мир должен жить и без игроков", () => {
    expect(botLoopDisabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("выключается только явным GAME_BOTS_LIVE=false", () => {
    // Строгое сравнение, а не «любое непустое значение»: опечатка в
    // переменной не должна тихо отключать мир.
    expect(botLoopDisabled({ GAME_BOTS_LIVE: "false" } as NodeJS.ProcessEnv)).toBe(true);
    expect(botLoopDisabled({ GAME_BOTS_LIVE: "true" } as NodeJS.ProcessEnv)).toBe(false);
    expect(botLoopDisabled({ GAME_BOTS_LIVE: "0" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("первый такт не совпадает со стартом процесса", () => {
    // Старт и так занят прогревом и миграциями — поход в языковую модель
    // добавлять к ним незачем.
    expect(FIRST_TICK_DELAY_MS).toBeGreaterThan(5_000);
    expect(FIRST_TICK_DELAY_MS).toBeLessThan(BOT_TICK_MS);
  });
});
