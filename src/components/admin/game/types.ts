// Данные админки игры. Один запрос — на все вкладки: разделение страницы
// на разделы не должно превращаться в пять походов на сервер за одним и тем
// же набором цифр.
export type GameStats = {
  players: {
    total: number;
    activeDay: number;
    activeWeek: number;
    avgEquity: number;
    maxEquity: number;
    totalEquity: number;
    avgReliability: number;
    avgLevel: number;
    contractsPassed: number;
    bestContractPct: number;
    byStyle: { style: string; count: number }[];
    byRank: { rank: string; count: number }[];
  };
  top: {
    userId: string;
    nickname: string;
    rankKey: string;
    prestige: number;
    level: number;
    equity: number;
    contractsPassed: number;
    bestContractPct: number;
    reliability: number;
    activeStyle: string;
    lastSyncAt: string;
  }[];
  funds: { name: string; capital: number; feePct: number; owner: string; members: number; createdAt: string }[];
  loans: { total: number; volume: number; byStatus: { status: string; count: number; amount: number }[] };
  market: {
    seed: string | null;
    startedAt: string | null;
    candles: number;
    news: number;
    assetsTotal: number;
    assetsGenerated: number;
    daysGenerated: number;
  };
  worldEventsWeek: number;
  chat: {
    id: string;
    channel: string;
    text: string;
    createdAt: number;
    removed: boolean;
    author: { id: string; nickname: string; mutedUntil: number | null };
  }[];
};

export const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} $`;
