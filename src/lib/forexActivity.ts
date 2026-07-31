// Twelve Data does not return a "volume" field for spot forex pairs at all
// (confirmed empirically — the API response has no `volume` key for
// "type":"Physical Currency" symbols, so FxCandle.v is always 0). Spot forex
// is OTC with no consolidated tape, so this is a permanent limitation of the
// data source, not a parsing bug.
//
// Indicators that need a volume-like magnitude (delta/CVD, bid/ask
// imbalance, divergence) use the candle's price range as an "activity" proxy
// instead — it's the only per-candle signal derivable from OHLC alone.
export function candleActivity(h: number, l: number): number {
  return Math.max(0, h - l);
}
