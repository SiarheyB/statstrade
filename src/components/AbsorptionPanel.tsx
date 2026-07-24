/**
 * AbsorptionPanel — таблица найденных паттернов absorption.
 * Показывает: время, цена, диапазон, объём, множитель объёма,
 * дельта-рейшио, длительность, силу.
 *
 * Состояния: loading, error, empty ("No absorption patterns detected"), data.
 */
"use client";

import { useMemo, useState } from "react";
import { HelpCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { zonedParts } from "@/lib/timezone";
import type { AbsorptionSignal } from "@/lib/orderflow";

type Props = {
  signals: AbsorptionSignal[];
  loading: boolean;
  error: string | null;
};

type SortKey = "t" | "strength" | "volumeMultiplier" | "duration" | "deltaRatio";

/** Форматирование времени: HH:MM */
function fmtTime(ms: number, tz: string): string {
  const { h, mi } = zonedParts(ms, tz as Parameters<typeof zonedParts>[1]);
  const p = (z: number) => String(z).padStart(2, "0");
  return `${p(h)}:${p(mi)}`;
}

export default function AbsorptionPanel({ signals, loading, error }: Props) {
  const { t, timezone } = useI18n();
  const [sortKey, setSortKey] = useState<SortKey>("strength");
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...signals];
    copy.sort((a, b) => {
      const mul = sortAsc ? 1 : -1;
      if (sortKey === "t") return (a.t - b.t) * mul;
      if (sortKey === "strength") return (a.strength - b.strength) * mul;
      if (sortKey === "volumeMultiplier") return (a.volumeMultiplier - b.volumeMultiplier) * mul;
      if (sortKey === "duration") return (a.duration - b.duration) * mul;
      if (sortKey === "deltaRatio") return (a.deltaRatio - b.deltaRatio) * mul;
      return 0;
    });
    return copy;
  }, [signals, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(false); }
  }

  const arrow = (key: SortKey) => {
    if (sortKey !== key) return " ↕";
    return sortAsc ? " ↑" : " ↓";
  };

  return (
    <div className="card p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-muted">
          {t("of.absorptionTitle") || "Absorption Patterns"}
        </span>
        <span title={t("of.hintAbsorption") || "Absorption: narrow range + high volume + near-zero delta. Signals accumulation/distribution."} className="inline-flex cursor-help">
          <HelpCircle size={12} className="text-faint shrink-0" />
        </span>
        {signals.length > 0 && (
          <span className="text-[11px] text-faint">
            {t("of.found", { n: signals.length })}
          </span>
        )}
      </div>

      {loading && (
        <div className="text-xs text-faint py-2">{t("common.loading")}</div>
      )}

      {error && (
        <div className="text-xs text-loss py-2">{error}</div>
      )}

      {!loading && !error && signals.length === 0 && (
        <div className="text-xs text-faint py-2">
          {t("of.noAbsorption") || "No absorption patterns detected"}
        </div>
      )}

      {!loading && !error && signals.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-faint text-left border-b border-border/50">
                <th className="font-medium py-1 pr-3 cursor-pointer select-none" onClick={() => toggleSort("t")}
                    title={t("of.thTimeHint") || "Candle timestamp when the absorption pattern started"}>
                  {t("of.thTime")}{arrow("t")}
                </th>
                <th className="font-medium py-1 pr-3 cursor-pointer select-none text-right" onClick={() => toggleSort("strength")}
                    title={t("of.thStrengthHint") || "Pattern strength: 1 (weak) to 5 (very strong). Based on volume multiplier, delta purity, range tightness, and duration."}>
                  {t("of.thStrength") || "Str"}{arrow("strength")}
                </th>
                <th className="font-medium py-1 pr-3 text-right"
                    title={t("of.thPriceHint") || "Mid price at the start of the pattern"}>
                  {t("of.thPrice") || "Price"}
                </th>
                <th className="font-medium py-1 pr-3 text-right"
                    title={t("of.thRangeHint") || "Price range (high - low) of pattern candles. A narrow range is typical for absorption."}>
                  {t("of.thRange") || "Range"}
                </th>
                <th className="font-medium py-1 pr-3 cursor-pointer select-none text-right" onClick={() => toggleSort("volumeMultiplier")}
                    title={t("of.thVolMultHint") || "How many times higher the volume is compared to the average. 2× means double the typical volume — the higher, the stronger the signal."}>
                  {t("of.thVolMult") || "Vol ×"}{arrow("volumeMultiplier")}
                </th>
                <th className="font-medium py-1 pr-3 cursor-pointer select-none text-right" onClick={() => toggleSort("deltaRatio")}
                    title={t("of.thDeltaRatioHint") || "|Buy - Sell| / (Buy + Sell) — how balanced buying and selling are. 0% = perfectly balanced (strong absorption), 15% = slight imbalance."}>
                  {t("of.thDeltaRatio") || "|Δ|/V"}{arrow("deltaRatio")}
                </th>
                <th className="font-medium py-1 pr-3 cursor-pointer select-none text-right" onClick={() => toggleSort("duration")}
                    title={t("of.thDurationHint") || "How many consecutive candles the pattern spans. More candles = longer accumulation/distribution period."}>
                  {t("of.thDuration") || "Dur"}{arrow("duration")}
                </th>
                <th className="font-medium py-1 text-right"
                    title={t("of.thLabelHint") || "Absorption (strength 1-3) = moderate signal. Strong Absorption (strength 4-5) = high-confidence accumulation/distribution."}>
                  {t("of.thLabel") || "Label"}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((sig, i) => (
                <tr key={i} className="border-b border-border/20">
                  <td className="text-faint py-0.5 pr-3">{fmtTime(sig.t, timezone)}</td>
                  <td className="py-0.5 pr-3 text-right">
                    <span className={`inline-flex items-center justify-center w-5 h-4 rounded text-[10px] font-bold ${
                      sig.strength >= 4
                        ? "bg-[rgba(147,112,219,0.25)] text-[rgba(180,140,255,0.95)]"
                        : sig.strength >= 3
                          ? "bg-[rgba(147,112,219,0.15)] text-[rgba(147,112,219,0.8)]"
                          : "bg-[rgba(147,112,219,0.08)] text-[rgba(147,112,219,0.6)]"
                    }`}>
                      {sig.strength}
                    </span>
                  </td>
                  <td className="text-fg py-0.5 pr-3 text-right">{sig.price.toFixed(2)}</td>
                  <td className="text-faint py-0.5 pr-3 text-right">{sig.range.toFixed(2)}</td>
                  <td className="text-fg py-0.5 pr-3 text-right">{sig.volumeMultiplier.toFixed(1)}×</td>
                  <td className="text-faint py-0.5 pr-3 text-right">{(sig.deltaRatio * 100).toFixed(0)}%</td>
                  <td className="text-faint py-0.5 pr-3 text-right">{sig.duration}</td>
                  <td className="text-right py-0.5">
                    <span
                      title={sig.strength >= 4 ? t("of.strongAbsorptionHint") : t("of.absorptionLabelHint")}
                      className={`text-[10px] cursor-help ${
                        sig.strength >= 4 ? "text-[rgba(180,140,255,0.95)] font-semibold" : "text-faint"
                      }`}
                    >
                      {sig.strength >= 4 ? t("of.strongAbsorptionLabel") : t("of.absorptionLabel")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}