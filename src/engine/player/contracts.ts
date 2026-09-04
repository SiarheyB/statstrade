// Контракты (испытания) — раздел «ядро игрового цикла» из docs/game/CONCEPT.md.
//
// Зачем: без цели игра была песочницей — «купи дешевле, продай дороже» это
// механика, а не задача. Контракт даёт то, чего не хватало: измеримую цель,
// срок и цену ошибки. Формат взят у prop-firm челленджей (FTMO и клоны),
// потому что он единственный из известных мне игровых форматов учит
// риск-менеджменту механикой, а не текстом: превысил просадку — испытание
// провалено, сколько бы ты до этого ни заработал.
//
// Контракт идёт НА СВОЁМ счёте игрока, а не на отдельном «выданном»:
// отдельный счёт потребовал бы второй набор позиций/маржи/истории, а
// смысла добавил бы ноль — цель и лимит просадки работают одинаково.
import contractsData from "@/data/contracts.json";
import type {
  Account,
  ActiveContract,
  Contract,
  ContractOutcome,
  ContractRecord,
  ContractState,
} from "@/engine/entities/types";

export const CONTRACTS = contractsData as Contract[];

export function freshContractState(): ContractState {
  return { active: null, history: [], completedIds: [] };
}

export function getContract(id: string): Contract | undefined {
  return CONTRACTS.find((c) => c.id === id);
}

/**
 * Что доступно игроку прямо сейчас. Ступени открываются строго по порядку:
 * следующий контракт виден, только когда пройден предыдущий. Это и есть
 * «лестница», которую игрок должен видеть с первой минуты.
 */
export function availableContracts(state: ContractState): Contract[] {
  const byTier = [...CONTRACTS].sort((a, b) => a.tier - b.tier);
  const result: Contract[] = [];
  for (const contract of byTier) {
    if (state.completedIds.includes(contract.id)) continue;
    result.push(contract);
    break; // показываем ровно одну следующую ступень — цель должна быть одна
  }
  return result;
}

export type StartError = "already_active" | "unknown_contract" | "already_completed" | "insufficient_funds";
export type StartResult = { ok: true; state: ContractState } | { ok: false; error: StartError };

/**
 * Взнос списывается сразу и НЕ возвращается при провале — иначе испытание
 * ничего не стоит, и оптимальная стратегия «жать до талого, провалился —
 * начал заново» ломает весь смысл лимита просадки.
 */
export function startContract(account: Account, state: ContractState, contractId: string, currentDay: number): StartResult {
  if (state.active) return { ok: false, error: "already_active" };
  const contract = getContract(contractId);
  if (!contract) return { ok: false, error: "unknown_contract" };
  if (state.completedIds.includes(contractId)) return { ok: false, error: "already_completed" };
  if (contract.entryFee > account.balance) return { ok: false, error: "insufficient_funds" };

  account.balance -= contract.entryFee;
  const equity = account.equity;
  const active: ActiveContract = {
    contractId,
    startedDay: currentDay,
    startEquity: equity,
    peakEquity: equity,
  };
  return { ok: true, state: { ...state, active } };
}

export interface ContractProgress {
  contract: Contract;
  profitPct: number; // текущий результат к стартовой эквити
  drawdownPct: number; // просадка от пика внутри контракта
  daysLeft: number;
}

export function contractProgress(active: ActiveContract, equity: number, currentDay: number): ContractProgress | null {
  const contract = getContract(active.contractId);
  if (!contract) return null;
  const peak = Math.max(active.peakEquity, equity);
  return {
    contract,
    profitPct: active.startEquity > 0 ? ((equity - active.startEquity) / active.startEquity) * 100 : 0,
    drawdownPct: peak > 0 ? ((peak - equity) / peak) * 100 : 0,
    daysLeft: Math.max(0, contract.durationDays - (currentDay - active.startedDay)),
  };
}

export interface ContractEvaluation {
  state: ContractState;
  finished: ContractRecord | null; // не null — контракт завершился на этом тике
}

/**
 * Проверяется КАЖДЫЙ тик. Порядок проверок важен: сначала просадка, потом
 * цель. Если на одном тике цена и превысила лимит просадки, и дотянула до
 * цели (гэп на новости), честнее засчитать провал — в реальном испытании
 * просадка фиксируется по факту касания, а не по итогу дня.
 */
export function evaluateContract(state: ContractState, equity: number, currentDay: number): ContractEvaluation {
  const active = state.active;
  if (!active) return { state, finished: null };
  const contract = getContract(active.contractId);
  if (!contract) return { state: { ...state, active: null }, finished: null };

  const peakEquity = Math.max(active.peakEquity, equity);
  const drawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
  const profitPct = active.startEquity > 0 ? ((equity - active.startEquity) / active.startEquity) * 100 : 0;
  const daysPassed = currentDay - active.startedDay;

  let outcome: ContractOutcome | null = null;
  if (drawdownPct > contract.maxDrawdownPct) outcome = "failed_drawdown";
  else if (profitPct >= contract.targetPct) outcome = "passed";
  else if (daysPassed >= contract.durationDays) outcome = "failed_expired";

  if (!outcome) {
    return { state: { ...state, active: { ...active, peakEquity } }, finished: null };
  }

  const record: ContractRecord = {
    contractId: contract.id,
    outcome,
    finishedDay: currentDay,
    resultPct: profitPct,
  };
  return {
    state: {
      active: null,
      history: [record, ...state.history].slice(0, 50),
      completedIds: outcome === "passed" ? [...state.completedIds, contract.id] : state.completedIds,
    },
    finished: record,
  };
}

/** Награда за пройденный контракт. Мутирует account (деньги и престиж). */
export function applyContractReward(account: Account, contract: Contract): void {
  account.balance += contract.reward.cash;
  account.reputation += contract.reward.prestige;
}

/** Досрочный отказ: взнос сгорает, ступень остаётся непройденной. */
export function abandonContract(state: ContractState, currentDay: number): ContractState {
  const active = state.active;
  if (!active) return state;
  const record: ContractRecord = {
    contractId: active.contractId,
    outcome: "abandoned",
    finishedDay: currentDay,
    resultPct: 0,
  };
  return { ...state, active: null, history: [record, ...state.history].slice(0, 50) };
}
