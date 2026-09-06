import { describe, it, expect } from "vitest";
import {
  freshTaxState,
  taxForPeriod,
  toolSubscriptionCost,
  DEFAULT_TAX_RATE_PCT,
  TOOL_SUBSCRIPTION_COST,
} from "@/engine/economy/taxes";
import type { JournalEntry } from "@/engine/entities/types";

let n = 0;
const entry = (pnl: number): JournalEntry => ({
  id: `j${n++}`,
  positionId: "p",
  timestampClosed: 0,
  gameDay: 0,
  pnl,
  rMultiple: 0,
  tags: [],
});

describe("налог на прибыль", () => {
  it("берётся с зафиксированной прибыли за период", () => {
    const { amount, state } = taxForPeriod([entry(1000)], freshTaxState(), 13);
    expect(amount).toBeCloseTo(130, 6);
    expect(state.settledTrades).toBe(1);
    expect(state.paidTotal).toBeCloseTo(130, 6);
  });

  it("убыточный период налога не создаёт", () => {
    const { amount } = taxForPeriod([entry(-500)], freshTaxState(), 13);
    expect(amount).toBe(0);
  });

  it("убыток переносится вперёд и уменьшает базу следующего периода", () => {
    // Без переноса игрок, заработавший сто и потерявший сто, платил бы налог
    // со ста, оставшись при своих. Это не строгость, это ошибка.
    const first = taxForPeriod([entry(-1000)], freshTaxState(), 13);
    expect(first.amount).toBe(0);
    expect(first.state.carriedLoss).toBeCloseTo(1000, 6);

    const second = taxForPeriod([entry(-1000), entry(1000)], first.state, 13);
    expect(second.amount).toBe(0);
    expect(second.state.carriedLoss).toBe(0);
  });

  it("после погашения убытка налог берётся только с превышения", () => {
    const first = taxForPeriod([entry(-1000)], freshTaxState(), 13);
    const second = taxForPeriod([entry(-1000), entry(1500)], first.state, 13);
    expect(second.amount).toBeCloseTo(500 * 0.13, 6);
  });

  it("одни и те же сделки не облагаются дважды", () => {
    const journal = [entry(1000)];
    const first = taxForPeriod(journal, freshTaxState(), 13);
    const second = taxForPeriod(journal, first.state, 13);
    expect(second.amount).toBe(0);
    expect(second.state.paidTotal).toBeCloseTo(first.state.paidTotal, 6);
  });

  it("нулевая ставка выключает налог целиком", () => {
    const { amount, state } = taxForPeriod([entry(10_000)], freshTaxState(), 0);
    expect(amount).toBe(0);
    // Сделки при этом всё равно отмечаются учтёнными: включив налог позже,
    // админ не должен обложить задним числом всю прошлую историю.
    expect(state.settledTrades).toBe(1);
  });

  it("незакрытой прибыли в журнале нет — значит и налога с неё нет", () => {
    expect(taxForPeriod([], freshTaxState(), DEFAULT_TAX_RATE_PCT).amount).toBe(0);
  });
});

describe("абонплата за инструменты", () => {
  it("платится за каждый открытый инструмент", () => {
    expect(toolSubscriptionCost({ orderBookAnywhere: false, screener: false, newsRadar: false })).toBe(0);
    expect(toolSubscriptionCost({ orderBookAnywhere: true, screener: false, newsRadar: false })).toBe(
      TOOL_SUBSCRIPTION_COST,
    );
    expect(toolSubscriptionCost({ orderBookAnywhere: true, screener: true, newsRadar: true })).toBe(
      3 * TOOL_SUBSCRIPTION_COST,
    );
  });
});
