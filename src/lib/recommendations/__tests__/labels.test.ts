import { describe, it, expect } from "vitest";
import { directionLabel, levelTypeLabel, signalLabel } from "../labels";

describe("levelTypeLabel", () => {
  it("translates known level types", () => {
    expect(levelTypeLabel("break_point")).toBe("точка излома тренда");
    expect(levelTypeLabel("mirror")).toBe("зеркальный");
  });

  it("falls back to the raw key for unknown types", () => {
    expect(levelTypeLabel("unknown_type")).toBe("unknown_type");
  });
});

describe("directionLabel", () => {
  it("translates trade sides and tolerates a missing direction", () => {
    expect(directionLabel("long")).toBe("лонг");
    expect(directionLabel("short")).toBe("шорт");
    expect(directionLabel(null)).toBe("");
  });
});

describe("signalLabel", () => {
  it("translates known signal keys", () => {
    expect(signalLabel("close_near_level")).toBe("закрытие дня близко к уровню");
    expect(signalLabel("near_retest")).toBe("недавний ретест уровня");
  });

  it("falls back to the raw key for unknown signals", () => {
    expect(signalLabel("some_new_signal")).toBe("some_new_signal");
  });
});
