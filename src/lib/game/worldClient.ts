"use client";

// Клиент общего мира: тонкая обёртка над /api/game/*.
//
// Все денежные операции здесь ДВУХСТОРОННИЕ: сервер записывает
// обязательство, а игровой баланс двигает стор (см. gameStore.applyWorldCash).
// Поэтому каждая функция возвращает сумму, которую вызывающий обязан
// применить у себя — забыть это значит потерять деньги игрока.
export interface WorldPlayer {
  id: string;
  nickname: string;
  fundName: string | null;
  rankKey: string;
  prestige: number;
  level: number;
  equity: number;
  contractsPassed: number;
  bestContractPct: number;
  activeStyle: string;
  reliability: number;
  lastSyncAt: string;
  fund: { id: string; name: string } | null;
}

export interface WorldEvent {
  id: string;
  kind: string;
  createdAt: string;
  payload: Record<string, string | number | null>;
}

export interface WorldFund {
  id: string;
  name: string;
  motto: string | null;
  capital: number;
  feePct: number;
  createdAt: string;
  owner: { nickname: string };
  members: { id: string; nickname: string; equity: number; contractsPassed: number }[];
  memberCount: number;
  totalEquity: number;
  power: number;
}

export interface LoanOffer {
  id: string;
  amount: number;
  interestPct: number;
  dueGameDay: number; // в предложении это СРОК в днях, а не день (см. lib/game/loans.ts)
  createdAt: string;
  lender: { id: string; nickname: string; reliability: number } | null;
}

export interface LoanRow {
  id: string;
  amount: number;
  interestPct: number;
  dueGameDay: number;
  status: string;
  lender?: { nickname: string } | null;
  borrower?: { nickname: string } | null;
}

export interface WorldState {
  me: {
    id: string;
    nickname: string;
    rankKey: string;
    prestige: number;
    equity: number;
    contractsPassed: number;
    reliability: number;
    pendingPayout: number;
    isPublic: boolean;
    fundId: string | null;
    creditLimit: number;
    fundShare: number;
  };
  leaderboard: WorldPlayer[];
  feed: WorldEvent[];
  funds: WorldFund[];
  loans: { offers: LoanOffer[]; mine: LoanRow[]; given: LoanRow[] };
  myFund: {
    id: string;
    name: string;
    motto: string | null;
    capital: number;
    feePct: number;
    ownerId: string;
    owner: { nickname: string };
    members: { id: string; nickname: string; equity: number; contractsPassed: number; rankKey: string }[];
  } | null;
}

async function post<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as { error?: string }).error ?? "Не получилось" };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export async function fetchWorld(): Promise<WorldState | null> {
  try {
    const res = await fetch("/api/game/world");
    if (!res.ok) return null;
    return (await res.json()) as WorldState;
  } catch {
    return null;
  }
}

export interface SyncSnapshot {
  fundName: string | null;
  rankKey: string;
  prestige: number;
  level: number;
  equity: number;
  contractsPassed: number;
  bestContractPct: number;
  activeStyle: string;
  gameDay: number;
}

export function syncSnapshot(snapshot: SyncSnapshot) {
  return post<{ claimed: number; defaulted: number; reliability: number; nickname: string }>("/api/game/sync", snapshot);
}

export function updateProfile(patch: { nickname?: string; isPublic?: boolean }) {
  return (async () => {
    try {
      const res = await fetch("/api/game/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false as const, error: (data as { error?: string }).error ?? "Не получилось" };
      return { ok: true as const, data: data as { nickname: string; isPublic: boolean } };
    } catch {
      return { ok: false as const, error: "Нет связи с сервером" };
    }
  })();
}

export const loans = {
  offer: (amount: number, interestPct: number, termDays: number) =>
    post<{ id: string }>("/api/game/loans", { action: "offer", amount, interestPct, termDays }),
  cancel: (loanId: string) => post<{ refund: number }>("/api/game/loans", { action: "cancel", loanId }),
  take: (loanId: string, gameDay: number, perkBonus: number) =>
    post<{ amount: number; dueGameDay: number }>("/api/game/loans", { action: "take", loanId, gameDay, perkBonus }),
  repay: (loanId: string) => post<{ paid: number }>("/api/game/loans", { action: "repay", loanId }),
};

export const funds = {
  create: (name: string, motto: string, feePct: number) =>
    post<{ id: string; cost: number }>("/api/game/funds", { action: "create", name, motto, feePct }),
  join: (fundId: string) => post<{ name: string }>("/api/game/funds", { action: "join", fundId }),
  leave: () => post<{ refund: number }>("/api/game/funds", { action: "leave" }),
  deposit: (amount: number) => post<{ amount: number }>("/api/game/funds", { action: "deposit", amount }),
  withdraw: (amount: number) => post<{ amount: number }>("/api/game/funds", { action: "withdraw", amount }),
  payout: (amount: number) => post<{ distributed: number }>("/api/game/funds", { action: "payout", amount }),
};
