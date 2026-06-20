"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, FileDown, FileText } from "lucide-react";
import type { StatsResponse, SerializedTrade } from "@/lib/types";
import { riskPerTradeAmount, type RiskProfileData } from "@/lib/risk";
import { findRiskMistake } from "@/lib/annotations";
import { Term } from "@/components/Term";
import { TradeChart } from "@/components/TradeChart";
import { fmtUsd, fmtPct, fmtDuration, fmtDate, fmtPrice, fmtNum, fmtSymbol } from "@/lib/format";
import { downloadCsv, nodeToPdf, dateStamp } from "@/lib/export";
import { useI18n } from "@/lib/i18n/provider";

type SortKey = "exitTime" | "netPnl" | "returnPct" | "durationMs" | "fees";
type Ann = {
  entryPoint: string | null;
  entryType: string | null;
  mistakes: string[];
  pattern: string | null;
  stopLoss: number | null;
};
const PAGE_SIZE = 25;
const UNSET = "__unset__";

export default function TradesPage() {
  const { t } = useI18n();
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [ann, setAnn] = useState<Record<string, Ann>>({});
  const [riskProfiles, setRiskProfiles] = useState<Record<string, RiskProfileData>>({});
  const [accountFilter, setAccountFilter] = useState("all");
  const [symbolFilter, setSymbolFilter] = useState("all");
  const [marketFilter, setMarketFilter] = useState("all");
  const [sideFilter, setSideFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [epFilter, setEpFilter] = useState("all");
  const [etFilter, setEtFilter] = useState("all");
  const [mtFilter, setMtFilter] = useState("all");
  const [ptFilter, setPtFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("exitTime");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<{ trade: SerializedTrade; x: number; y: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onTickerEnter(e: React.MouseEvent, tr: SerializedTrade) {
    const x = e.clientX;
    const y = e.clientY;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setChart({ trade: tr, x, y }), 250);
  }
  function onTickerLeave() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setChart(null);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/stats");
    if (res.ok) {
      const d: StatsResponse = await res.json();
      setData(d);
      const map: Record<string, Ann> = {};
      for (const tr of d.trades) {
        map[tr.id] = {
          entryPoint: tr.entryPoint,
          entryType: tr.entryType,
          mistakes: tr.mistakes,
          pattern: tr.pattern,
          stopLoss: tr.stopLoss,
        };
      }
      setAnn(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Risk profiles drive the R-multiple column: when the risk manager is on and a
  // per-trade risk is set, RR = netPnl / configured risk (1R).
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/risk/settings");
      if (res.ok) setRiskProfiles((await res.json()).profiles ?? {});
    })();
  }, []);

  const epOptions = data?.entryPointOptions ?? [];
  const etOptions = data?.entryTypeOptions ?? [];
  const mtOptions = data?.mistakeOptions ?? [];
  const ptOptions = data?.patternOptions ?? [];
  // The configured mistake meaning "risk exceeded" (auto-tagged when RR < -1).
  const riskMistake = findRiskMistake(mtOptions);

  // Mistakes shown for a trade = user-set ones + the auto "risk exceeded" tag
  // when the loss exceeded the per-trade risk (RR < -1). The auto tag is derived
  // (not persisted), so it can't be removed and never fights manual edits.
  function effectiveMistakes(mistakes: string[], rr: number | null): string[] {
    if (rr != null && rr < -1 && riskMistake && !mistakes.includes(riskMistake)) {
      return [...mistakes, riskMistake];
    }
    return mistakes;
  }

  function annOf(tr: SerializedTrade): Ann {
    return (
      ann[tr.id] ?? {
        entryPoint: tr.entryPoint,
        entryType: tr.entryType,
        mistakes: tr.mistakes,
        pattern: tr.pattern,
        stopLoss: tr.stopLoss,
      }
    );
  }

  async function saveAnn(tradeKey: string, next: Ann) {
    setAnn((prev) => ({ ...prev, [tradeKey]: next }));
    await fetch("/api/annotations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tradeKey, ...next }),
    }).catch(() => {});
  }

  const balanceOf = (accountId: string): number | null =>
    data?.accounts.find((a) => a.id === accountId)?.balance ?? null;

  // R-multiple for a trade. If the risk manager is enabled with a per-trade risk,
  // R = netPnl / risk (money-based). Otherwise fall back to the stop-loss model.
  function rrFor(tr: SerializedTrade, stopLoss: number | null): number | null {
    const prof = riskProfiles[tr.accountId] ?? riskProfiles[""];
    if (prof) {
      const riskAmt = riskPerTradeAmount(prof, balanceOf(tr.accountId));
      if (riskAmt && riskAmt > 0) return tr.netPnl / riskAmt;
    }
    return rrOf(tr, stopLoss);
  }

  const filtered = useMemo(() => {
    let rows = data?.trades ?? [];
    if (accountFilter !== "all") rows = rows.filter((tr) => tr.accountId === accountFilter);
    if (symbolFilter !== "all") rows = rows.filter((tr) => tr.symbol === symbolFilter);
    if (marketFilter === "spot") rows = rows.filter((tr) => tr.market === "spot");
    else if (marketFilter === "futures") rows = rows.filter((tr) => tr.market !== "spot");
    if (sideFilter !== "all") rows = rows.filter((tr) => tr.side === sideFilter);
    if (resultFilter !== "all") rows = rows.filter((tr) => tr.result === resultFilter);
    if (epFilter !== "all")
      rows = rows.filter((tr) => {
        const v = annOf(tr).entryPoint;
        return epFilter === UNSET ? !v : v === epFilter;
      });
    if (etFilter !== "all")
      rows = rows.filter((tr) => {
        const v = annOf(tr).entryType;
        return etFilter === UNSET ? !v : v === etFilter;
      });
    if (mtFilter !== "all")
      rows = rows.filter((tr) => {
        const ms = annOf(tr).mistakes;
        return mtFilter === UNSET ? ms.length === 0 : ms.includes(mtFilter);
      });
    if (ptFilter !== "all")
      rows = rows.filter((tr) => {
        const v = annOf(tr).pattern;
        return ptFilter === UNSET ? !v : v === ptFilter;
      });
    return [...rows].sort((a, b) => {
      const av = sortVal(a, sortKey);
      const bv = sortVal(b, sortKey);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ann, accountFilter, symbolFilter, marketFilter, sideFilter, resultFilter, epFilter, etFilter, mtFilter, ptFilter, sortKey, sortDir]);

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  }

  function resultLabel(r: string): string {
    return r === "win" ? t("trades.win") : r === "loss" ? t("trades.loss") : t("trades.breakeven");
  }

  function exportCsv() {
    const headers = [
      t("trades.col.symbol"), t("trades.col.side"), t("trades.col.market"),
      t("trades.export.open"), t("trades.export.close"), t("trades.export.durationMin"),
      t("trades.col.qty"), t("trades.col.entry"), t("trades.col.exit"), t("trades.col.stop"),
      t("trades.col.rr"), t("trades.export.fee"), t("trades.col.return"), t("trades.col.netPnl"),
      t("trades.export.result"), t("trades.col.pattern"), t("trades.col.entryPoint"),
      t("trades.col.entryType"), t("trades.col.mistake"),
    ];
    const rows = filtered.map((tr) => {
      const a = annOf(tr);
      const rr = rrFor(tr, a.stopLoss);
      return [
        fmtSymbol(tr.symbol),
        tr.side === "long" ? "Long" : "Short",
        tr.market === "spot" ? "spot" : "perp",
        fmtDate(tr.entryTime),
        fmtDate(tr.exitTime),
        Math.round(tr.durationMs / 60000),
        tr.qty.toFixed(6),
        tr.entryPrice,
        tr.exitPrice,
        a.stopLoss ?? "",
        rr == null ? "" : rr.toFixed(2),
        tr.fees.toFixed(2),
        tr.returnPct.toFixed(2),
        tr.netPnl.toFixed(2),
        resultLabel(tr.result),
        a.pattern ?? "",
        a.entryPoint ?? "",
        a.entryType ?? "",
        effectiveMistakes(a.mistakes, rr).join("; "),
      ];
    });
    downloadCsv(`trades-${dateStamp()}.csv`, headers, rows);
  }

  async function exportPdf() {
    if (!printRef.current) return;
    setExporting(true);
    try {
      await new Promise((r) => setTimeout(r, 50));
      await nodeToPdf(printRef.current, `trades-${dateStamp()}.pdf`, "l");
    } finally {
      setExporting(false);
    }
  }

  const SELECT = "input-base text-sm py-1.5 cursor-pointer";

  return (
    <div className="px-4 sm:px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">{t("trades.title")}</h1>
          <p className="text-sm text-muted">{t("trades.subtitle", { n: filtered.length })}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg input-base text-sm hover:border-border-strong"
          >
            <FileDown size={14} /> {t("trades.csv")}
          </button>
          <button
            onClick={exportPdf}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg input-base text-sm hover:border-border-strong disabled:opacity-50"
          >
            <FileText size={14} /> {exporting ? "…" : t("trades.pdf")}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select className={SELECT} value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setPage(0); }}>
          <option value="all">{t("trades.allAccounts")}</option>
          {data?.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <select className={SELECT} value={symbolFilter} onChange={(e) => { setSymbolFilter(e.target.value); setPage(0); }}>
          <option value="all">{t("trades.allSymbols")}</option>
          {data?.symbols.map((s) => <option key={s} value={s}>{fmtSymbol(s)}</option>)}
        </select>
        <select className={SELECT} value={marketFilter} onChange={(e) => { setMarketFilter(e.target.value); setPage(0); }}>
          <option value="all">{t("dash.allMarkets")}</option>
          <option value="spot">{t("dash.spot")}</option>
          <option value="futures">{t("dash.futures")}</option>
        </select>
        <select className={SELECT} value={sideFilter} onChange={(e) => { setSideFilter(e.target.value); setPage(0); }}>
          <option value="all">Long + Short</option>
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>
        <select className={SELECT} value={resultFilter} onChange={(e) => { setResultFilter(e.target.value); setPage(0); }}>
          <option value="all">{t("trades.allResults")}</option>
          <option value="win">{t("trades.win")}</option>
          <option value="loss">{t("trades.loss")}</option>
          <option value="breakeven">{t("trades.breakeven")}</option>
        </select>
        <select className={SELECT} value={epFilter} onChange={(e) => { setEpFilter(e.target.value); setPage(0); }}>
          <option value="all">{t("dash.allEntryPoints")}</option>
          {epOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value={UNSET}>{t("common.unset")}</option>
        </select>
        <select className={SELECT} value={etFilter} onChange={(e) => { setEtFilter(e.target.value); setPage(0); }}>
          <option value="all">{t("dash.allEntryTypes")}</option>
          {etOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value={UNSET}>{t("common.unset")}</option>
        </select>
        <select className={SELECT} value={ptFilter} onChange={(e) => { setPtFilter(e.target.value); setPage(0); }}>
          <option value="all">{t("dash.allPatterns")}</option>
          {ptOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value={UNSET}>{t("common.unset")}</option>
        </select>
        <select className={SELECT} value={mtFilter} onChange={(e) => { setMtFilter(e.target.value); setPage(0); }}>
          <option value="all">{t("dash.allMistakes")}</option>
          {mtOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value={UNSET}>{t("common.unset")}</option>
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-faint">{t("common.loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center text-muted">{t("trades.empty")}</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted border-b border-border">
                  <Th>{t("trades.col.symbol")}</Th>
                  <Th>{t("trades.col.side")}</Th>
                  <Th>{t("trades.col.market")}</Th>
                  <Th sortable onClick={() => toggleSort("exitTime")} active={sortKey === "exitTime"}>{t("trades.col.close")}</Th>
                  <Th sortable onClick={() => toggleSort("durationMs")} active={sortKey === "durationMs"}>{t("trades.col.duration")}</Th>
                  <Th right>{t("trades.col.qty")}</Th>
                  <Th right>{t("trades.col.entry")}</Th>
                  <Th right>{t("trades.col.exit")}</Th>
                  <Th right sortable onClick={() => toggleSort("returnPct")} active={sortKey === "returnPct"}><Term name="Return">{t("trades.col.return")}</Term></Th>
                  <Th right sortable onClick={() => toggleSort("netPnl")} active={sortKey === "netPnl"}>{t("trades.col.netPnl")}</Th>
                  <Th right sortable onClick={() => toggleSort("fees")} active={sortKey === "fees"}><Term name="Fees">{t("trades.col.fees")}</Term></Th>
                  <Th right>{t("trades.col.stop")}</Th>
                  <Th right><Term name="RR">{t("trades.col.rr")}</Term></Th>
                  <Th>{t("trades.col.pattern")}</Th>
                  <Th>{t("trades.col.entryPoint")}</Th>
                  <Th>{t("trades.col.entryType")}</Th>
                  <Th>{t("trades.col.mistake")}</Th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((tr) => {
                  const a = annOf(tr);
                  const rr = rrFor(tr, a.stopLoss);
                  return (
                    <tr key={tr.id} data-trade-id={tr.id} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                      <td
                        className={`px-3 py-2 font-medium border-l-2 ${tr.side === "long" ? "border-l-profit/60" : "border-l-loss/60"}`}
                        onMouseEnter={(e) => onTickerEnter(e, tr)}
                        onMouseLeave={onTickerLeave}
                      >
                        <span className="cursor-pointer border-b border-dotted border-faint/50">{fmtSymbol(tr.symbol)}</span>
                      </td>
                      <td className="px-3 py-2"><SideBadge side={tr.side} /></td>
                      <td className="px-3 py-2 text-xs text-faint uppercase">
                        <Term name={tr.market === "spot" ? "spot" : "perp"}>
                          {tr.market === "spot" ? "spot" : "perp"}
                        </Term>
                      </td>
                      <td className="px-3 py-2 text-muted whitespace-nowrap">{fmtDate(tr.exitTime)}</td>
                      <td className="px-3 py-2 text-muted">{fmtDuration(tr.durationMs)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtNum(tr.qty, 4)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtPrice(tr.entryPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtPrice(tr.exitPrice)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${tr.returnPct >= 0 ? "text-profit" : "text-loss"}`}>{fmtPct(tr.returnPct)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${tr.netPnl >= 0 ? "text-profit" : "text-loss"}`}>{fmtUsd(tr.netPnl, { sign: true })}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtUsd(tr.fees)}</td>
                      <td className="px-3 py-2 text-right">
                        <StopInput value={a.stopLoss} onSave={(v) => saveAnn(tr.id, { ...a, stopLoss: v })} />
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${rr == null ? "text-faint" : rr >= 0 ? "text-profit" : "text-loss"}`}>
                        {fmtRR(rr)}
                      </td>
                      <td className="px-3 py-2">
                        <AnnSelect value={a.pattern} options={ptOptions} onChange={(v) => saveAnn(tr.id, { ...a, pattern: v })} />
                      </td>
                      <td className="px-3 py-2">
                        <AnnSelect value={a.entryPoint} options={epOptions} onChange={(v) => saveAnn(tr.id, { ...a, entryPoint: v })} />
                      </td>
                      <td className="px-3 py-2">
                        <AnnSelect value={a.entryType} options={etOptions} onChange={(v) => saveAnn(tr.id, { ...a, entryType: v })} />
                      </td>
                      <td className="px-3 py-2">
                        <MistakeMultiSelect
                          value={a.mistakes}
                          options={mtOptions}
                          auto={rr != null && rr < -1 ? riskMistake : null}
                          onChange={(v) => saveAnn(tr.id, { ...a, mistakes: v })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-3 py-2.5 text-sm border-t border-border">
            <span className="text-faint">{t("trades.page", { p: page + 1, total: totalPages })}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1 rounded-lg input-base disabled:opacity-40">{t("common.back")}</button>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1 rounded-lg input-base disabled:opacity-40">{t("common.next")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden full-table render used only for PDF capture */}
      <div style={{ position: "absolute", left: -99999, top: 0, width: 1400 }} aria-hidden>
        <div ref={printRef} className="bg-bg p-6">
          <div className="text-lg font-semibold mb-1">{t("trades.title")} — TradeStats</div>
          <div className="text-sm text-muted mb-4">{filtered.length} {t("common.trades")} · {dateStamp()}</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted border-b border-border-strong">
                {[
                  t("trades.col.symbol"), t("trades.col.side"), t("trades.col.market"),
                  t("trades.col.close"), t("trades.col.duration"), t("trades.col.return"),
                  t("trades.col.netPnl"), t("trades.col.fees"), t("trades.col.stop"), t("trades.col.rr"),
                  t("trades.col.pattern"), t("trades.col.entryPoint"), t("trades.col.entryType"), t("trades.col.mistake"),
                ].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((tr) => {
                const a = annOf(tr);
                const rr = rrFor(tr, a.stopLoss);
                return (
                  <tr key={tr.id} className="border-b border-border">
                    <td className="px-2 py-1 font-medium">{fmtSymbol(tr.symbol)}</td>
                    <td className="px-2 py-1">{tr.side === "long" ? "Long" : "Short"}</td>
                    <td className="px-2 py-1 uppercase text-faint">{tr.market === "spot" ? "spot" : "perp"}</td>
                    <td className="px-2 py-1 text-muted">{fmtDate(tr.exitTime)}</td>
                    <td className="px-2 py-1 text-muted">{fmtDuration(tr.durationMs)}</td>
                    <td className={tr.returnPct >= 0 ? "text-profit px-2 py-1" : "text-loss px-2 py-1"}>{fmtPct(tr.returnPct)}</td>
                    <td className={tr.netPnl >= 0 ? "text-profit px-2 py-1" : "text-loss px-2 py-1"}>{fmtUsd(tr.netPnl, { sign: true })}</td>
                    <td className="px-2 py-1 text-muted">{fmtUsd(tr.fees)}</td>
                    <td className="px-2 py-1">{a.stopLoss ?? "—"}</td>
                    <td className="px-2 py-1">{fmtRR(rr)}</td>
                    <td className="px-2 py-1">{a.pattern ?? "—"}</td>
                    <td className="px-2 py-1">{a.entryPoint ?? "—"}</td>
                    <td className="px-2 py-1">{a.entryType ?? "—"}</td>
                    <td className="px-2 py-1">{effectiveMistakes(a.mistakes, rr).join("; ") || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Floating trade chart on ticker hover */}
      {chart && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: Math.max(8, Math.min(chart.x + 16, window.innerWidth - 372)),
            top: Math.max(8, Math.min(chart.y + 16, window.innerHeight - 290)),
          }}
        >
          <div className="card border-border-strong p-3 w-[360px] shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">{fmtSymbol(chart.trade.symbol)}</span>
              <SideBadge side={chart.trade.side} />
            </div>
            <TradeChart trade={{ ...chart.trade, stopLoss: annOf(chart.trade).stopLoss }} />
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-faint">
                {fmtDate(chart.trade.entryTime)} → {fmtDate(chart.trade.exitTime)}
              </span>
              <span className={chart.trade.netPnl >= 0 ? "text-profit" : "text-loss"}>
                {fmtUsd(chart.trade.netPnl, { sign: true })}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AnnSelect({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: string[];
  onChange: (v: string | null) => void;
}) {
  const opts = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="input-base text-xs py-1 cursor-pointer min-w-[8rem]"
    >
      <option value="">—</option>
      {opts.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

// Multi-select for mistakes: selected ones are removable chips; `auto` (when
// set) is a non-removable derived chip ("risk exceeded"); the dropdown adds the
// remaining options.
function MistakeMultiSelect({
  value,
  options,
  auto,
  onChange,
}: {
  value: string[];
  options: string[];
  auto: string | null;
  onChange: (v: string[]) => void;
}) {
  const { t } = useI18n();
  const showAuto = auto && !value.includes(auto);
  const available = options.filter((o) => !value.includes(o));
  return (
    <div className="flex flex-wrap items-center gap-1 min-w-[10rem] max-w-[16rem]">
      {value.map((m) => (
        <span
          key={m}
          className="inline-flex items-center gap-1 rounded bg-surface-2 border border-border px-1.5 py-0.5 text-xs"
        >
          {m}
          <button
            onClick={() => onChange(value.filter((x) => x !== m))}
            className="text-faint hover:text-loss leading-none"
            aria-label="remove"
          >
            ×
          </button>
        </span>
      ))}
      {showAuto && (
        <span
          title={t("trades.mistake.autoRisk")}
          className="inline-flex items-center gap-1 rounded border border-dashed border-loss/50 bg-loss/10 text-loss px-1.5 py-0.5 text-xs"
        >
          {auto}
          <span className="opacity-70">⚠</span>
        </span>
      )}
      {available.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...value, e.target.value]);
          }}
          className="input-base text-xs py-1 cursor-pointer w-8"
          aria-label={t("trades.col.mistake")}
        >
          <option value="">＋</option>
          {available.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      )}
    </div>
  );
}

function parseStop(raw: string): number | null {
  const x = Number(raw.trim().replace(",", "."));
  return Number.isFinite(x) && x > 0 ? x : null;
}

// Stop-loss cell. Saves reliably: debounced auto-save while typing, plus an
// immediate commit on blur / Enter. The prop→draft sync is suppressed while the
// field is focused so auto-save never clobbers in-progress input.
function StopInput({
  value,
  onSave,
}: {
  value: number | null;
  onSave: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!focused.current) setDraft(value != null ? String(value) : "");
  }, [value]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function commit(raw: string) {
    const next = parseStop(raw);
    if (next !== value) onSave(next);
    return next;
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      placeholder="—"
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(v), 600);
      }}
      onBlur={() => {
        focused.current = false;
        if (timer.current) clearTimeout(timer.current);
        const next = commit(draft);
        setDraft(next != null ? String(next) : "");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="input-base text-xs py-1 w-20 text-right"
    />
  );
}

function Th({
  children,
  right,
  sortable,
  active,
  onClick,
}: {
  children: React.ReactNode;
  right?: boolean;
  sortable?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2.5 font-medium ${right ? "text-right" : "text-left"} ${sortable ? "cursor-pointer select-none hover:text-fg" : ""} ${active ? "text-accent" : ""}`}
    >
      <span className={`inline-flex items-center gap-1 ${right ? "flex-row-reverse" : ""}`}>
        {children}
        {sortable && <ArrowUpDown size={12} />}
      </span>
    </th>
  );
}

function SideBadge({ side }: { side: string }) {
  const long = side === "long";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${long ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"}`}>
      {long ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      <Term name={long ? "Long" : "Short"}>{long ? "Long" : "Short"}</Term>
    </span>
  );
}

function sortVal(tr: SerializedTrade, key: SortKey): number {
  if (key === "exitTime") return new Date(tr.exitTime).getTime();
  return tr[key];
}

// Realized R-multiple, measured in price terms where the stop distance is 1R.
// Exiting exactly at the stop yields -1R, regardless of position size or fees.
function rrOf(tr: SerializedTrade, stopLoss: number | null): number | null {
  if (stopLoss == null) return null;
  const risk = Math.abs(tr.entryPrice - stopLoss);
  if (risk <= 0) return null;
  const move =
    tr.side === "long" ? tr.exitPrice - tr.entryPrice : tr.entryPrice - tr.exitPrice;
  return move / risk;
}

function fmtRR(rr: number | null): string {
  if (rr == null) return "—";
  return `${rr > 0 ? "+" : ""}${rr.toFixed(2)}R`;
}
