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
} as const;

export type FeatureConfigValue<K extends FeatureKey> = {
  enabled: boolean;
} & Omit<(typeof FEATURE_DEFAULTS)[K], "label">;
