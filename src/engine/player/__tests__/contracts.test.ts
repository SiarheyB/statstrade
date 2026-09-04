import { describe, it, expect } from "vitest";
import {
  abandonContract,
  applyContractReward,
  availableContracts,
  contractProgress,
  CONTRACTS,
  evaluateContract,
  freshContractState,
  getContract,
  startContract,
} from "@/engine/player/contracts";
import type { Account, ContractState } from "@/engine/entities/types";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "player",
    balance: 10_000,
    equity: 10_000,
    positions: [],
    pendingOrders: [],
    marginUsed: 0,
    marginLevel: Infinity,
    psychology: { stress: 0, confidence: 50, discipline: 0, consecutiveWins: 0, consecutiveLosses: 0, lastTradeAt: 0 },
    skills: {},
    reputation: 0,
    licenses: [],
    journal: [],
    ...overrides,
  };
}

function started(day = 0, equity = 10_000): ContractState {
  const account = makeAccount({ equity });
  const result = startContract(account, freshContractState(), "CT_DEMO", day);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("каталог контрактов", () => {
  it("ступени идут по возрастанию сложности: цель выше, взнос дороже, награда больше", () => {
    const sorted = [...CONTRACTS].sort((a, b) => a.tier - b.tier);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].entryFee).toBeGreaterThan(sorted[i - 1].entryFee);
      expect(sorted[i].reward.cash).toBeGreaterThan(sorted[i - 1].reward.cash);
      expect(sorted[i].reward.prestige).toBeGreaterThan(sorted[i - 1].reward.prestige);
    }
  });

  it("награда за первый контракт не требует взноса — на старте платить нечем", () => {
    const first = [...CONTRACTS].sort((a, b) => a.tier - b.tier)[0];
    expect(first.entryFee).toBe(0);
  });

  it("лимит просадки всегда меньше цели: иначе испытание проходится случайной волатильностью", () => {
    for (const contract of CONTRACTS) {
      expect(contract.maxDrawdownPct).toBeLessThanOrEqual(contract.targetPct);
    }
  });
});

describe("availableContracts", () => {
  it("показывает ровно одну следующую ступень", () => {
    expect(availableContracts(freshContractState())).toHaveLength(1);
    expect(availableContracts(freshContractState())[0].id).toBe("CT_DEMO");
  });

  it("после прохождения открывает следующую", () => {
    const state: ContractState = { ...freshContractState(), completedIds: ["CT_DEMO"] };
    expect(availableContracts(state)[0].id).toBe("CT_TRIAL_I");
  });
});

describe("startContract", () => {
  it("списывает взнос и запоминает стартовую эквити", () => {
    const account = makeAccount({ balance: 10_000, equity: 12_000 });
    const state: ContractState = { ...freshContractState(), completedIds: ["CT_DEMO"] };
    const result = startContract(account, state, "CT_TRIAL_I", 7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(account.balance).toBe(10_000 - getContract("CT_TRIAL_I")!.entryFee);
    expect(result.state.active).toEqual({
      contractId: "CT_TRIAL_I",
      startedDay: 7,
      startEquity: 12_000,
      peakEquity: 12_000,
    });
  });

  it("не даёт взять второй контракт, пройденный повторно и неоплаченный", () => {
    const withActive = started();
    expect(startContract(makeAccount(), withActive, "CT_DEMO", 0)).toEqual({ ok: false, error: "already_active" });

    const completed: ContractState = { ...freshContractState(), completedIds: ["CT_DEMO"] };
    expect(startContract(makeAccount(), completed, "CT_DEMO", 0)).toEqual({ ok: false, error: "already_completed" });

    const poor = makeAccount({ balance: 10 });
    expect(startContract(poor, completed, "CT_TRIAL_I", 0)).toEqual({ ok: false, error: "insufficient_funds" });
  });
});

describe("evaluateContract", () => {
  it("без активного контракта ничего не делает", () => {
    const state = freshContractState();
    expect(evaluateContract(state, 10_000, 5)).toEqual({ state, finished: null });
  });

  it("копит пик эквити — от него считается просадка", () => {
    const next = evaluateContract(started(), 10_400, 1);
    expect(next.finished).toBeNull();
    expect(next.state.active?.peakEquity).toBe(10_400);
  });

  it("засчитывает победу при достижении цели", () => {
    const next = evaluateContract(started(), 10_500, 3); // CT_DEMO: +5%
    expect(next.finished?.outcome).toBe("passed");
    expect(next.state.completedIds).toContain("CT_DEMO");
    expect(next.state.active).toBeNull();
  });

  it("проваливает при превышении лимита просадки от ПИКА, а не от старта", () => {
    // Выросли до 10 400 (+4%, до цели не дотянули), потом сползли до 9 800:
    // от старта это −2%, а от пика −5.8% — и вот это уже провал (CT_DEMO: 5%).
    const grown = evaluateContract(started(), 10_400, 2).state;
    expect(grown.active?.peakEquity).toBe(10_400);
    const next = evaluateContract(grown, 9_800, 3);
    expect(next.finished?.outcome).toBe("failed_drawdown");
  });

  it("плавание внутри лимита не завершает контракт", () => {
    const grown = evaluateContract(started(), 10_400, 2).state;
    const next = evaluateContract(grown, 10_100, 3); // −2.9% от пика, лимит 5%
    expect(next.finished).toBeNull();
    expect(next.state.active).not.toBeNull();
  });

  it("проваливает по истечении срока", () => {
    const next = evaluateContract(started(0), 10_100, 20); // CT_DEMO: 20 дней
    expect(next.finished?.outcome).toBe("failed_expired");
  });

  it("история ограничена и новые записи идут первыми", () => {
    let state = started();
    const first = evaluateContract(state, 10_500, 3);
    state = first.state;
    expect(state.history[0].contractId).toBe("CT_DEMO");
    expect(state.history.length).toBe(1);
  });
});

describe("contractProgress", () => {
  it("считает результат, просадку и остаток срока", () => {
    const state = evaluateContract(started(0), 10_400, 2).state;
    const progress = contractProgress(state.active!, 10_192, 5);
    expect(progress!.profitPct).toBeCloseTo(1.92, 5);
    expect(progress!.drawdownPct).toBeCloseTo(2, 5); // от пика 10 400
    expect(progress!.daysLeft).toBe(15);
  });
});

describe("награда и отказ", () => {
  it("награда начисляет деньги и престиж", () => {
    const account = makeAccount();
    applyContractReward(account, getContract("CT_DEMO")!);
    expect(account.balance).toBe(10_000 + 2_000);
    expect(account.reputation).toBe(5);
  });

  it("отказ закрывает контракт и не отмечает его пройденным", () => {
    const state = abandonContract(started(), 4);
    expect(state.active).toBeNull();
    expect(state.completedIds).toEqual([]);
    expect(state.history[0].outcome).toBe("abandoned");
  });
});
