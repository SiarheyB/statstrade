// Normalize a broker symbol (often suffixed: EURUSD.m, GBPJPYpro, XAUUSD#) into a
// clean symbol + base/quote, and pick a sensible contract/pip size by asset type.

const CURRENCIES = [
  "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNH", "SGD",
  "HKD", "ZAR", "SEK", "NOK", "DKK", "TRY", "MXN", "PLN", "CZK", "HUF", "RUB",
];
const METALS = ["XAU", "XAG", "XPT", "XPD"];

export type SymbolInfo = {
  symbol: string;
  base: string;
  quote: string;
  market: string; // forex | metal | cfd
  contractSize: number;
  pipSize: number;
};

export function normalizeSymbol(raw: string, accountCurrency = "USD"): SymbolInfo {
  const letters = raw.toUpperCase().replace(/[^A-Z]/g, "");
  const first3 = letters.slice(0, 3);
  const next3 = letters.slice(3, 6);
  const isCur = (c: string) => CURRENCIES.includes(c);

  // FX pair: two known 3-letter currencies (ignores any suffix letters after).
  if (letters.length >= 6 && isCur(first3) && isCur(next3)) {
    return {
      symbol: first3 + next3,
      base: first3,
      quote: next3,
      market: "forex",
      contractSize: 100_000,
      pipSize: next3 === "JPY" ? 0.01 : 0.0001,
    };
  }

  // Metals (XAUUSD, XAGUSD …).
  if (METALS.includes(first3) && isCur(next3)) {
    return {
      symbol: first3 + next3,
      base: first3,
      quote: next3,
      market: "metal",
      contractSize: first3 === "XAU" ? 100 : 5000,
      pipSize: 0.01,
    };
  }

  // Index / CFD / crypto-CFD: keep the cleaned symbol, quote in account currency.
  const sym = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return {
    symbol: sym || raw.toUpperCase(),
    base: sym || raw.toUpperCase(),
    quote: accountCurrency,
    market: "cfd",
    contractSize: 1,
    pipSize: 1,
  };
}
