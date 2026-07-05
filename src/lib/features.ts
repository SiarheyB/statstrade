// Registry of optional/configurable features toggled from /admin/features.
// One place to add a new feature key + its tunable defaults — the admin page
// renders a generic form from this, no new UI needed per feature.

export type FeatureKey = keyof typeof FEATURE_DEFAULTS;

export const FEATURE_DEFAULTS = {
  // Aggregate MFE/MAE "exit efficiency" analytics across recent trades
  // (Analytics page). Fetches public OHLC per trade from the exchange, so the
  // limits below protect against hammering the exchange's public API for
  // accounts with a lot of trades.
  exitEfficiency: {
    label: "Exit efficiency (MFE/MAE aggregate)",
    // Сколько последних сделок анализировать за один расчёт.
    maxTrades: 60,
    // Сколько параллельных запросов к публичному API биржи одновременно.
    concurrency: 3,
  },
  // Bootstrap Monte Carlo simulation (Risk of Ruin) from the user's own trade
  // history — 100% client-side compute, no external API calls, but a big
  // simulations × projectedTrades product can noticeably block the tab for a
  // moment, hence both being admin-tunable.
  monteCarlo: {
    label: "Monte Carlo / Risk of Ruin",
    // Сколько случайных путей симулировать.
    simulations: 1000,
    // На сколько сделок вперёд прогонять каждый путь.
    projectedTrades: 100,
    // Просадка от пика (%), при которой путь считается «разорившимся».
    ruinDrawdownPct: 50,
  },
  // Именованные стратегии/сетапы с текстом правил + статистикой по сделкам
  // с этим паттерном (страница /dashboard/playbooks). Лимит числа плейбуков
  // на юзера — защита от неограниченного роста таблицы Playbook.
  playbooks: {
    label: "Playbooks",
    maxPerUser: 20,
  },
  // "Mentor Mode" — read-only public capability links (/share/[token]) into a
  // user's aggregate stats, for sharing with a mentor/coach without a login.
  // Master on/off matters here more than for the others: this is the one
  // feature that adds an UNAUTHENTICATED public route reading from the DB, so
  // an admin may want a hard kill switch regardless of individual links.
  mentorMode: {
    label: "Mentor Mode (share links)",
    maxLinksPerUser: 5,
  },
} as const;

export type FeatureConfigValue<K extends FeatureKey> = {
  enabled: boolean;
} & Omit<(typeof FEATURE_DEFAULTS)[K], "label">;
