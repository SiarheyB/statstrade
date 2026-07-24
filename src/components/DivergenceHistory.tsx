"use client";

import { useState, useMemo } from "react";
import { HelpCircle, ArrowUp, ArrowDown } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { zonedParts } from "@/lib/timezone";
import type { DivergenceSignal } from "@/lib/orderflow";

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtP(p: number): string {
  if (p >= 1000) return Math.round(p).toLocaleString("en-US");
  if (p >= 1) return p.toFixed(2);
  return p.toPrecision(4);
}

function fmtDelta(d: number): string {
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(0)}`;
}

function fmtTime(ms: number, tz: string): string {
  const { d, mo, h, mi } = zonedParts(ms, tz);
  const p = (z: number) => String(z).padStart(2, "0");
  return `${p(d)}.${p(mo + 1)} ${p(h)}:${p(mi)}`;
}

// ─── Sort state ────────────────────────────────────────────────────────────

type SortKey = "strength" | "t" | "type" | "bars" | "label";
type SortDir = "asc" | "desc";

const TYPE_COLORS: Record<string, string> = {
  regular_bearish: "text-loss",
  regular_bullish: "text-profit",
  hidden_bearish: "text-faint/80",
  hidden_bullish: "text-faint/80",
};

const TYPE_ARROW: Record<string, string> = {
  regular_bearish: "↓",
  regular_bullish: "↑",
  hidden_bearish: "⇓",
  hidden_bullish: "⇑",
};

// ─── Component ────────────────────────────────────────────────────────────

export default function DivergenceHistory({
  signals,
  loading,
  error,
}: {
  signals: DivergenceSignal[];
  loading: boolean;
  error: string | null;
}) {
  const { t, timezone } = useI18n();
  const [sortKey, setSortKey] = useState<SortKey>("strength");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(key === "t" ? "asc" : "desc");
    }
  };

  const sorted = useMemo(() => {
    const copy = [...signals];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "strength":
          cmp = a.strength - b.strength;
          break;
        case "t":
          cmp = a.t - b.t;
          break;
        case "bars":
          cmp = a.bars - b.bars;
          break;
        case "type":
          cmp = a.type.localeCompare(b.type);
          break;
        case "label":
          cmp = a.label.localeCompare(b.label);
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return copy;
  }, [signals, sortKey, sortDir]);

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return null;
    return sortDir === "desc" ? <ArrowDown size={10} className="inline ml-0.5" /> : <ArrowUp size={10} className="inline ml-0.5" />;
  };

  const thClass = "font-medium py-1 pr-3 cursor-pointer hover:text-fg transition select-none";
  const thRight = `${thClass} text-right`;

  // Loading state.
  if (loading) {
    return (
      <div className="card p-3 mt-3">
        <div className="text-xs font-medium text-muted mb-2 inline-flex items-center gap-1.5">
          {t("of.divergenceTitle") || "Divergence Scanner"}
          <HelpCircle size={12} className="text-faint shrink-0" />
        </div>
        <div className="flex items-center justify-center h-16 text-sm text-faint">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  // Error state.
  if (error) {
    return (
      <div className="card p-3 mt-3">
        <div className="text-xs font-medium text-muted mb-2 inline-flex items-center gap-1.5">
          {t("of.divergenceTitle") || "Divergence Scanner"}
          <HelpCircle size={12} className="text-faint shrink-0" />
        </div>
        <div className="text-sm text-loss">
          {error}
        </div>
      </div>
    );
  }

  // Empty state.
  if (signals.length === 0) {
    return (
      <div className="card p-3 mt-3">
        <div className="text-xs font-medium text-muted mb-2 inline-flex items-center gap-1.5">
          {t("of.divergenceTitle") || "Divergence Scanner"}
          <span title={t("of.divergenceHint") || "Divergence Scanner — detects discrepancies between price movement and delta/CVD."} className="inline-flex cursor-help">
            <HelpCircle size={12} className="text-faint shrink-0" />
          </span>
        </div>
        <div className="text-xs text-faint">
          {t("of.noDivergence") || "No divergences detected"}
        </div>
      </div>
    );
  }

  return (
    <div className="card p-3 mt-3">
      <div className="text-xs font-medium text-muted mb-1 inline-flex items-center gap-1.5">
        {t("of.divergenceTitle") || "Divergence Scanner"}
        <span title={t("of.divergenceHint") || "Divergence Scanner — detects discrepancies between price movement and delta/CVD. Regular Bearish: price HH, delta LH. Regular Bullish: price LL, delta HL. Hidden: continuation patterns."} className="inline-flex cursor-help">
          <HelpCircle size={12} className="text-faint shrink-0" />
        </span>
      </div>
      <div className="text-[11px] text-faint mb-2">
        {t("of.divergenceHint") || "Divergence between price and delta/CVD"}
      </div>

      <div className="min-h-[20px] min-w-[300px] w-full h-full">
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-faint text-left border-b border-border/50">
                <th className={thClass} onClick={() => toggleSort("t")}>
                  {t("of.thTime")} <SortIcon k="t" />
                </th>
                <th className={thClass} onClick={() => toggleSort("type")}>
                  {t("of.thType") || "Type"} <SortIcon k="type" />
                </th>
                <th className={thRight} onClick={() => toggleSort("strength")}>
                  {t("of.thStrength") || "Str"} <SortIcon k="strength" />
                </th>
                <th className={thRight}>
                  {t("of.thPrice")}
                </th>
                <th className={thRight}>
                  {t("of.thDelta") || "Δ"}
                </th>
                <th className={thRight} onClick={() => toggleSort("bars")}>
                  {t("of.thBars") || "Bars"} <SortIcon k="bars" />
                </th>
                <th className={thClass}>
                  {t("of.thStatus") || "Status"}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((sig) => (
                <tr key={sig.id} className="border-b border-border/20">
                  <td className="text-faint py-0.5 pr-3 whitespace-nowrap">
                    {fmtTime(sig.t, timezone)}
                  </td>
                  <td className={`py-0.5 pr-3 ${TYPE_COLORS[sig.type] ?? "text-fg"}`}>
                    {TYPE_ARROW[sig.type] ?? ""} {sig.label}
                  </td>
                  <td className="text-fg py-0.5 pr-3 text-right font-medium">
                    {sig.strength}
                  </td>
                  <td className="text-fg py-0.5 pr-3 text-right">
                    {fmtP(sig.pricePeak)} → {fmtP(sig.priceTrough)}
                  </td>
                  <td className="text-faint py-0.5 pr-3 text-right">
                    {fmtDelta(sig.deltaPeak)} → {fmtDelta(sig.deltaTrough)}
                  </td>
                  <td className="text-faint py-0.5 pr-3 text-right">
                    {sig.bars}
                  </td>
                  <td className="py-0.5 pr-3">
                    {sig.confirmed ? (
                      <span className="text-profit text-[11px]">{t("of.confirmed") || "Confirmed"}</span>
                    ) : (
                      <span className="text-faint/70 text-[11px]">{t("of.pending") || "Pending"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}