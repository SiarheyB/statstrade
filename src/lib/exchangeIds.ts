// Pure exchange-id metadata — deliberately has NO import of `ccxt` (unlike
// lib/exchanges.ts), so it's safe to import from client components. `ccxt`
// bundles protobufjs stuff that breaks the Turbopack browser build if it
// ever ends up in a client bundle (see CLAUDE.md gotcha re: serverExternalPackages).
// lib/exchanges.ts re-exports these for server-side code that already needs ccxt.

export type ExchangeId =
  | "binance"
  | "bybit"
  | "okx"
  | "kraken"
  | "kucoin"
  | "bitget"
  | "gate"
  | "mexc"
  | "htx";

export type ExchangeMeta = {
  id: ExchangeId;
  name: string;
  needsPassphrase: boolean;
  supportsDemo: boolean; // есть ли у нас поддержка demo/testnet-режима
  docsUrl: string;
};

export const SUPPORTED_EXCHANGES: Record<ExchangeId, ExchangeMeta> = {
  binance: {
    id: "binance", name: "Binance", needsPassphrase: false, supportsDemo: true,
    docsUrl: "https://www.binance.com/en/my/settings/api-management",
  },
  bybit: {
    id: "bybit", name: "Bybit", needsPassphrase: false, supportsDemo: true,
    docsUrl: "https://www.bybit.com/app/user/api-management",
  },
  okx: {
    id: "okx", name: "OKX", needsPassphrase: true, supportsDemo: true,
    docsUrl: "https://www.okx.com/account/my-api",
  },
  kraken: {
    id: "kraken", name: "Kraken", needsPassphrase: false, supportsDemo: false,
    docsUrl: "https://www.kraken.com/u/security/api",
  },
  kucoin: {
    id: "kucoin", name: "KuCoin", needsPassphrase: true, supportsDemo: false,
    docsUrl: "https://www.kucoin.com/account/api",
  },
  bitget: {
    id: "bitget", name: "Bitget", needsPassphrase: true, supportsDemo: false,
    docsUrl: "https://www.bitget.com/account/newapi",
  },
  gate: {
    id: "gate", name: "Gate.io", needsPassphrase: false, supportsDemo: false,
    docsUrl: "https://www.gate.io/myaccount/apiv4keys",
  },
  mexc: {
    id: "mexc", name: "MEXC", needsPassphrase: false, supportsDemo: false,
    docsUrl: "https://www.mexc.com/user/openapi",
  },
  htx: {
    id: "htx", name: "HTX (Huobi)", needsPassphrase: false, supportsDemo: false,
    docsUrl: "https://www.htx.com/en-us/apikey/",
  },
};

export const EXCHANGE_IDS = Object.keys(SUPPORTED_EXCHANGES) as ExchangeId[];

export function isExchangeId(value: string): value is ExchangeId {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_EXCHANGES, value);
}
