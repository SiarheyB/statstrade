"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, FileDown, RefreshCw, AlertTriangle, ChevronRight } from "lucide-react";
import type { SerializedTrade, AccountSummary } from "@/lib/types";
import { tradeRR, type RiskProfileData } from "@/lib/risk";
import { Term } from "@/components/Term";
import { TradeChart } from "@/components/charts.lazy";
import TradeImageCell from "@/components/TradeImageCell";
import ImagePreviewModal from "@/components/ImagePreviewModal";
import { fmtUsd, fmtPct, fmtDuration, fmtDate, fmtPrice, fmtNumSmart, fmtSymbol } from "@/lib/format";
import { downloadCsv, dateStamp } from "@/lib/export";
import SearchSelect from "@/components/SearchSelect";
import { Pagination } from "@/components/Pagination";
import { useI18n } from "@/lib/i18n/provider";
import { zonedParts } from "@/lib/timezone";
import { useSync } from "@/components/SyncProvider";

type SortKey = "entryTime" | "exitTime" | "netPnl" | "returnPct" | "durationMs" | "fees";
type Ann = {
  entryPoint: string | null;
  entryType: string | null;
  mistake: string | null;
  pattern: string | null;
  stopLoss: number | null;
  note: string | null;
};
const PAGE_SIZE = 25;
const UNSET = "__unset__";

// Ответ /api/trades: страница сделок + общее число под пагинацию. symbols
// приходит только на первый запрос (withMeta=1).
type TradesResponse = {
  trades: SerializedTrade[];
  total: number;
  page: number;
  pageSize: number;
  symbols?: string[];
};

type TagOptions = {
  entryPointOptions: string[];
  entryTypeOptions: string[];
  mistakeOptions: string[];
  patternOptions: string[];
};

// Short market label for the table/exports.
function marketShort(market: string): string {
  if (market === "spot") return "spot";
  if (market === "forex" || market === "metal" || market === "cfd") return "forex";
  return "perp";
}

export default function TradesPage() {
  const { t, timezone } = useI18n();
  const { anySyncing, completedAt, syncAll } = useSync();
  const [data, setData] = useState<TradesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // Словари фильтров приходят из своих эндпоинтов, а не вместе со сделками:
  // от страницы/фильтров они не зависят и перезапрашивать их незачем.
  const [symbols, setSymbols] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [options, setOptions] = useState<TagOptions>({
    entryPointOptions: [], entryTypeOptions: [], mistakeOptions: [], patternOptions: [],
  });
  const [ann, setAnn] = useState<Record<string, Ann>>({});
  const [images, setImages] = useState<Record<string, { url: string | null; provider: string | null; publicUrl: string | null }>>({});
  const [cloudConnected, setCloudConnected] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [chart, setChart] = useState<{ trade: SerializedTrade; x: number; y: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onTickerEnter(e: React.MouseEvent, tr: SerializedTrade) {
    const x = e.clientX;
    const y = e.clientY;
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setChart({ trade: tr, x, y }), 250);
  }
  function onTickerLeave() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    // Small grace period so the mouse can travel from the ticker onto the
    // popup itself (e.g. to hover the MFE/MAE term tooltips inside it)
    // without the popup vanishing first.
    closeTimer.current = setTimeout(() => setChart(null), 200);
  }
  function onPopupEnter() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  function onPopupLeave() {
    setChart(null);
  }

  // Параметры выборки для сервера. Фильтры, сортировка и страница целиком
  // обслуживаются в БД — раньше страница тянула /api/stats без параметров, то
  // есть ВСЮ историю сделок (плюс ~60 метрик, ни одна из которых тут не нужна),
  // и фильтровала/резала её в браузере ради 25 строк.
  const queryParams = useCallback(
    (over: Record<string, string> = {}) =>
      new URLSearchParams({
        accountId: accountFilter,
        symbol: symbolFilter,
        market: marketFilter,
        side: sideFilter,
        result: resultFilter,
        entryPoint: epFilter,
        entryType: etFilter,
        mistake: mtFilter,
        pattern: ptFilter,
        sort: sortKey,
        dir: sortDir,
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...over,
      }),
    [accountFilter, symbolFilter, marketFilter, sideFilter, resultFilter,
     epFilter, etFilter, mtFilter, ptFilter, sortKey, sortDir, page],
  );

  const load = useCallback(async () => {
    setLoading(true);
    // Список тикеров для фильтра требует прохода по всем сделкам, поэтому
    // просим его только один раз — пока он ещё не загружен.
    const withMeta: Record<string, string> = symbols.length === 0 ? { withMeta: "1" } : {};
    const res = await fetch(`/api/trades?${queryParams(withMeta)}`);
    if (res.ok) {
      const d: TradesResponse = await res.json();
      setData(d);
      if (d.symbols) setSymbols(d.symbols);
      // Аннотации накапливаем по мере просмотра страниц: правки ниже пишутся в
      // это же состояние, поэтому затирать его целиком нельзя.
      setAnn((prev) => {
        const next = { ...prev };
        for (const tr of d.trades) {
          next[tr.id] = {
            entryPoint: tr.entryPoint,
            entryType: tr.entryType,
            mistake: tr.mistake,
            pattern: tr.pattern,
            stopLoss: tr.stopLoss,
            note: tr.note,
          };
        }
        return next;
      });
      // images (imageUrl/imageProvider overrides) НЕ трогаем на каждый load() —
      // imageOf() и так падает обратно на tr.imageUrl/tr.imageProvider из
      // свежих данных, когда явного оверрайда нет. Сбрасывать его здесь
      // затирало бы только что загруженную ссылку, если load() перезапустится
      // (например, из-за фонового автосинка) сразу после аплоада.
    }
    setLoading(false);
    // symbols намеренно НЕ в зависимостях: иначе первая же загрузка (которая их
    // и проставляет) немедленно вызвала бы вторую.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryParams]);

  useEffect(() => {
    load();
  }, [load]);

  // Словари тегов и счета живут в своих эндпоинтах и от фильтров не зависят —
  // грузим один раз.
  useEffect(() => {
    (async () => {
      const [settings, accs] = await Promise.all([
        fetch("/api/settings").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/accounts").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (settings) setOptions(settings);
      if (Array.isArray(accs)) setAccounts(accs);
    })();
  }, []);

  // Статус подключения облака (Google Drive и/или Яндекс.Диск) — определяет,
  // показывать ли кнопку «Загрузить» или ссылку в настройки в детальной
  // панели сделки. Хватает хотя бы одного подключённого провайдера —
  // /api/trade-images сам выберет, куда грузить (см. PROVIDER_PRIORITY).
  useEffect(() => {
    (async () => {
      const [gdrive, ydisk] = await Promise.all([
        fetch("/api/integrations/google-drive").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/integrations/yandex-disk").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      setCloudConnected(gdrive?.connected === true || ydisk?.connected === true);
    })();
  }, []);

  function imageOf(tr: SerializedTrade): { url: string | null; provider: string | null; publicUrl: string | null } {
    return tr.id in images
      ? images[tr.id]
      : { url: tr.imageUrl, provider: tr.imageProvider, publicUrl: tr.imagePublicUrl };
  }

  // Reload trades once a background sync finishes (new fills may have landed).
  useEffect(() => {
    if (completedAt) load();
  }, [completedAt, load]);

  // Risk profiles drive the R-multiple column: when the risk manager is on and a
  // per-trade risk is set, RR = netPnl / configured risk (1R).
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/risk/settings");
      if (res.ok) setRiskProfiles((await res.json()).profiles ?? {});
    })();
  }, []);

  const epOptions = options.entryPointOptions;
  const etOptions = options.entryTypeOptions;
  const mtOptions = options.mistakeOptions;
  const ptOptions = options.patternOptions;

  function annOf(tr: SerializedTrade): Ann {
    return (
      ann[tr.id] ?? {
        entryPoint: tr.entryPoint,
        entryType: tr.entryType,
        mistake: tr.mistake,
        pattern: tr.pattern,
        stopLoss: tr.stopLoss,
        note: tr.note,
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
    accounts.find((a) => a.id === accountId)?.balance ?? null;

  // R-multiple for a trade — shared with /dashboard/calendar (src/lib/risk.ts)
  // so both pages agree on the same number for the same trade.
  function rrFor(tr: SerializedTrade, stopLoss: number | null): number | null {
    return tradeRR(tr, stopLoss, riskProfiles, balanceOf(tr.accountId));
  }

  // Фильтрация и сортировка выполнены на сервере — здесь только то, что он
  // прислал. Список тегов у строки берём из локального состояния ann, чтобы
  // правка сразу отражалась в UI до перезагрузки страницы.
  const pageRows = data?.trades ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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

  // Выгрузка идёт по ВСЕМУ отфильтрованному набору, а не по текущей странице,
  // поэтому запрашивает его отдельно (all=1) — на экране остаются 25 строк.
  async function exportCsv() {
    setExporting(true);
    let exportRows: SerializedTrade[] = [];
    try {
      const res = await fetch(`/api/trades?${queryParams({ all: "1" })}`);
      if (!res.ok) return;
      exportRows = ((await res.json()) as TradesResponse).trades;
    } catch {
      return;
    } finally {
      setExporting(false);
    }
    const headers = [
      t("trades.col.symbol"), t("trades.col.side"), t("trades.col.market"),
      t("trades.export.open"), t("trades.export.close"), t("trades.export.durationMin"),
      t("trades.col.qty"), t("trades.col.entry"), t("trades.col.exit"), t("trades.col.stop"),
      t("trades.col.rr"), t("trades.export.fee"), t("trades.col.return"), t("trades.col.netPnl"),
      t("trades.export.result"), t("trades.col.pips"), t("trades.col.swap"),
      t("trades.col.pattern"), t("trades.col.entryPoint"),
      t("trades.col.entryType"), t("trades.col.mistake"), t("trades.col.image"),
    ];
    const rows = exportRows.map((tr) => {
      const a = annOf(tr);
      const rr = rrFor(tr, a.stopLoss);
      const image = imageOf(tr);
      // publicUrl работает без входа в приложение (см. TradeImageCell/
      // /api/trade-images). Фолбэк на imageUrl — на случай старых записей
      // без publicUrl (загружены до появления этого поля) или для
      // google_drive, где оба поля совпадают; для yandex_disk imageUrl там —
      // наш защищённый сессией прокси-путь, поэтому достраиваем origin,
      // чтобы ссылка хотя бы открывалась (хоть и потребует входа).
      const imageLink =
        image.publicUrl ??
        (image.url ? (image.url.startsWith("/") ? `${window.location.origin}${image.url}` : image.url) : "");
      return [
        fmtSymbol(tr.symbol),
        tr.side === "long" ? "Long" : "Short",
        marketShort(tr.market),
        fmtDate(tr.entryTime),
        fmtDate(tr.exitTime),
        Math.round(tr.durationMs / 60000),
        tr.lots != null ? tr.lots.toFixed(2) : tr.qty.toFixed(6),
        tr.entryPrice,
        tr.exitPrice,
        a.stopLoss ?? "",
        rr == null ? "" : rr.toFixed(2),
        tr.fees.toFixed(2),
        tr.returnPct.toFixed(2),
        tr.netPnl.toFixed(2),
        resultLabel(tr.result),
        tr.pips ?? "",
        tr.swap ?? "",
        a.pattern ?? "",
        a.entryPoint ?? "",
        a.entryType ?? "",
        a.mistake ?? "",
        imageLink,
      ];
    });
    downloadCsv(`trades-${dateStamp()}.csv`, headers, rows);
  }

  const SELECT = "input-base text-sm py-1.5 cursor-pointer";

  return (
    <div className="px-4 sm:px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">{t("trades.title")}</h1>
          <p className="text-sm text-muted">{t("trades.subtitle", { n: total })}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => syncAll()}
            disabled={anySyncing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/15 text-accent text-sm hover:bg-accent/25 disabled:opacity-60"
          >
            <RefreshCw size={14} className={anySyncing ? "animate-spin" : ""} />
            {anySyncing ? t("trades.syncing") : t("trades.syncAll")}
          </button>
          <button
            onClick={exportCsv}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg input-base text-sm hover:border-border-strong disabled:opacity-60"
          >
            <FileDown size={14} className={exporting ? "animate-pulse" : ""} /> {t("trades.csv")}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select className={SELECT} value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setPage(0); }}>
          <option value="all">{t("trades.allAccounts")}</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <SearchSelect
          value={symbolFilter}
          options={symbols}
          allLabel={t("trades.allSymbols")}
          placeholder={t("trades.searchSymbol")}
          renderLabel={fmtSymbol}
          onChange={(v) => { setSymbolFilter(v); setPage(0); }}
        />
        <select className={SELECT} value={marketFilter} onChange={(e) => { setMarketFilter(e.target.value); setPage(0); }}>
          <option value="all">{t("dash.allMarkets")}</option>
          <option value="spot">{t("dash.spot")}</option>
          <option value="futures">{t("dash.futures")}</option>
          <option value="forex">{t("dash.forex")}</option>
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
      ) : total === 0 ? (
        <div className="card p-10 text-center text-muted">{t("trades.empty")}</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted border-b border-border">
                  <Th />
                  <Th><Term desc={t("trades.colDesc.symbol")}>{t("trades.col.symbol")}</Term></Th>
                  <Th><Term desc={t("trades.colDesc.side")}>{t("trades.col.side")}</Term></Th>
                  <Th><Term desc={t("trades.colDesc.market")}>{t("trades.col.market")}</Term></Th>
                  <Th sortable onClick={() => toggleSort("entryTime")} active={sortKey === "entryTime"}><Term desc={t("trades.colDesc.entryTime")}>{t("trades.col.open")}</Term></Th>
                  <Th sortable onClick={() => toggleSort("exitTime")} active={sortKey === "exitTime"}><Term desc={t("trades.colDesc.close")}>{t("trades.col.close")}</Term></Th>
                  <Th sortable onClick={() => toggleSort("durationMs")} active={sortKey === "durationMs"}><Term desc={t("trades.colDesc.duration")}>{t("trades.col.duration")}</Term></Th>
                  <Th right><Term desc={t("trades.colDesc.qty")}>{t("trades.col.qty")}</Term></Th>
                  <Th right><Term desc={t("trades.colDesc.entry")}>{t("trades.col.entry")}</Term></Th>
                  <Th right><Term desc={t("trades.colDesc.exit")}>{t("trades.col.exit")}</Term></Th>
                  <Th right sortable onClick={() => toggleSort("returnPct")} active={sortKey === "returnPct"}><Term name="Return">{t("trades.col.return")}</Term></Th>
                  <Th right sortable onClick={() => toggleSort("netPnl")} active={sortKey === "netPnl"}><Term desc={t("trades.colDesc.netPnl")}>{t("trades.col.netPnl")}</Term></Th>
                  <Th right sortable onClick={() => toggleSort("fees")} active={sortKey === "fees"}><Term name="Fees">{t("trades.col.fees")}</Term></Th>
                  <Th right><Term name="RR">{t("trades.col.rr")}</Term></Th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((tr) => {
                  const a = annOf(tr);
                  const rr = rrFor(tr, a.stopLoss);
                  const expanded = expandedId === tr.id;
                  return (
                    <Fragment key={tr.id}>
                    <tr
                      data-trade-id={tr.id}
                      onClick={() => setExpandedId(expanded ? null : tr.id)}
                      className={`cursor-pointer border-b border-border last:border-0 hover:bg-surface-2/50 ${expanded ? "bg-surface-2/40" : ""}`}
                    >
                      <td className={`pl-3 pr-1 py-2 text-faint border-l-2 ${tr.side === "long" ? "border-l-profit/60" : "border-l-loss/60"}`}>
                        <ChevronRight size={14} className={`transition ${expanded ? "rotate-90 text-fg" : ""}`} />
                      </td>
                      <td className="px-3 py-2 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {rr != null && rr < -1 && (
                            <span className="relative group inline-flex shrink-0" title={t("trades.riskWarning")}>
                              <AlertTriangle size={14} className="text-loss" />
                              <span className="pointer-events-none absolute left-0 top-full mt-1 z-30 hidden group-hover:block w-56 whitespace-normal rounded-md border border-loss/40 bg-bg px-2.5 py-1.5 text-xs text-loss shadow-lg">
                                {t("trades.riskWarning")}
                              </span>
                            </span>
                          )}
                          <span
                            className="border-b border-dotted border-faint/50"
                            onMouseEnter={(e) => onTickerEnter(e, tr)}
                            onMouseLeave={onTickerLeave}
                          >
                            {fmtSymbol(tr.symbol)}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2"><SideBadge side={tr.side} /></td>
                      <td className="px-3 py-2 text-xs text-faint uppercase">
                        <Term name={marketShort(tr.market)}>
                          {marketShort(tr.market)}
                        </Term>
                      </td>
                      <td className="px-3 py-2 text-muted whitespace-nowrap text-center leading-tight">
                        <div>{fmtDate(tr.entryTime)}</div>
                        <div className="text-[10px] text-faint/70">{fmtTime(tr.entryTime, timezone)}</div>
                      </td>
                      <td className="px-3 py-2 text-muted whitespace-nowrap text-center leading-tight">
                        <div>{fmtDate(tr.exitTime)}</div>
                        <div className="text-[10px] text-faint/70">{fmtTime(tr.exitTime, timezone)}</div>
                      </td>
                      <td className="px-3 py-2 text-muted">{fmtDuration(tr.durationMs)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{tr.lots != null ? fmtNumSmart(tr.lots, 2) : fmtNumSmart(tr.qty, 4)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtPrice(tr.entryPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtPrice(tr.exitPrice)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${tr.returnPct >= 0 ? "text-profit" : "text-loss"}`}>{fmtPct(tr.returnPct)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${tr.netPnl >= 0 ? "text-profit" : "text-loss"}`}>{fmtUsd(tr.netPnl, { sign: true })}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtUsd(tr.fees)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${rr == null ? "text-faint" : rr >= 0 ? "text-profit" : "text-loss"}`}>{fmtRR(rr)}</td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-border bg-surface-2/20">
                        <td colSpan={13} className="px-4 py-4">
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                            {tr.lots != null && (
                              <>
                                <DetailField label={t("trades.col.pips")}>
                                  <span className={`text-sm tabular-nums ${(tr.pips ?? 0) >= 0 ? "text-profit" : "text-loss"}`}>
                                    {tr.pips != null ? tr.pips.toFixed(1) : "—"}
                                  </span>
                                </DetailField>
                                <DetailField label={t("trades.col.swap")}>
                                  <span className="text-sm tabular-nums text-muted">{fmtUsd(tr.swap ?? 0, { sign: true })}</span>
                                </DetailField>
                              </>
                            )}
                            <DetailField label={t("trades.col.stop")}>
                              <StopInput value={a.stopLoss} onSave={(v) => saveAnn(tr.id, { ...a, stopLoss: v })} />
                            </DetailField>
                            <DetailField label={t("trades.col.entryPoint")}>
                              <AnnSelect value={a.entryPoint} options={epOptions} onChange={(v) => saveAnn(tr.id, { ...a, entryPoint: v })} />
                            </DetailField>
                            <DetailField label={t("trades.col.pattern")}>
                              <AnnSelect value={a.pattern} options={ptOptions} onChange={(v) => saveAnn(tr.id, { ...a, pattern: v })} />
                            </DetailField>
                            <DetailField label={t("trades.col.entryType")}>
                              <AnnSelect value={a.entryType} options={etOptions} onChange={(v) => saveAnn(tr.id, { ...a, entryType: v })} />
                            </DetailField>
                            <DetailField label={t("trades.col.mistake")}>
                              <AnnSelect value={a.mistake} options={mtOptions} onChange={(v) => saveAnn(tr.id, { ...a, mistake: v })} />
                            </DetailField>
                            <DetailField label={t("trades.col.image")}>
                              <TradeImageCell
                                tradeKey={tr.id}
                                symbol={tr.symbol}
                                entryTime={tr.entryTime}
                                result={tr.result}
                                pattern={a.pattern}
                                imageUrl={imageOf(tr).url}
                                connected={cloudConnected}
                                onUploaded={(url, provider, publicUrl) => setImages((prev) => ({ ...prev, [tr.id]: { url, provider, publicUrl } }))}
                                onDeleted={() => setImages((prev) => ({ ...prev, [tr.id]: { url: null, provider: null, publicUrl: null } }))}
                                onPreview={(url) => setPreviewUrl(url)}
                              />
                            </DetailField>
                          </div>
                          <div className="mt-4">
                            <div className="text-xs text-faint mb-1">{t("trades.comment")}</div>
                            <NoteInput value={a.note} onSave={(v) => saveAnn(tr.id, { ...a, note: v })} />
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end px-3 py-2.5 text-sm border-t border-border">
            <Pagination
              page={page + 1}
              totalPages={totalPages}
              onChange={(p) => setPage(p - 1)}
              prevLabel={t("common.back")}
              nextLabel={t("common.next")}
              pageAriaLabel={t("trades.page", { p: page + 1, total: totalPages })}
            />
          </div>
        </div>
      )}

      {/* Floating trade chart on ticker hover */}
      {chart && (
        <div
          className="fixed z-50"
          style={{
            left: Math.max(8, Math.min(chart.x + 16, window.innerWidth - 372)),
            top: Math.max(8, Math.min(chart.y + 16, window.innerHeight - 290)),
          }}
          onMouseEnter={onPopupEnter}
          onMouseLeave={onPopupLeave}
        >
          <div className="card border-border-strong p-3 w-[360px] shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">{fmtSymbol(chart.trade.symbol)}</span>
              <SideBadge side={chart.trade.side} />
            </div>
            <TradeChart trade={{ ...chart.trade, stopLoss: annOf(chart.trade).stopLoss }} />
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-faint">
                {fmtDate(chart.trade.entryTime)} {fmtTime(chart.trade.entryTime, timezone)} → {fmtDate(chart.trade.exitTime)} {fmtTime(chart.trade.exitTime, timezone)}
              </span>
              <span className={chart.trade.netPnl >= 0 ? "text-profit" : "text-loss"}>
                {fmtUsd(chart.trade.netPnl, { sign: true })}
              </span>
            </div>
          </div>
        </div>
      )}

      {previewUrl && (
        // key=url — remounts on a new image so zoom/pan resets, instead of
        // an effect syncing it (see ImagePreviewModal for why).
        <ImagePreviewModal key={previewUrl} url={previewUrl} onClose={() => setPreviewUrl(null)} />
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
      className="input-base text-xs py-1 cursor-pointer w-full"
    >
      <option value="">—</option>
      {opts.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

// One labelled control in the expanded trade-detail panel.
function DetailField({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-faint mb-1">{label}</div>
      {children}
    </div>
  );
}

// Free-text comment for a trade. Debounced auto-save while typing, plus an
// immediate commit on blur; the prop→draft sync is suppressed while focused.
function NoteInput({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value ?? "");
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!focused.current) setDraft(value ?? "");
  }, [value]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function commit(raw: string) {
    const next = raw.trim() || null;
    if (next !== (value ?? null)) onSave(next);
  }

  return (
    <textarea
      value={draft}
      rows={3}
      maxLength={2000}
      placeholder={t("trades.commentPlaceholder")}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(v), 700);
      }}
      onBlur={() => {
        focused.current = false;
        if (timer.current) clearTimeout(timer.current);
        commit(draft);
      }}
      className="input-base w-full text-sm resize-y"
    />
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
      maxLength={20}
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
      className="input-base text-xs py-1 w-full text-right"
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
  children?: React.ReactNode;
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

function fmtRR(rr: number | null): string {
  if (rr == null) return "—";
  return `${rr > 0 ? "+" : ""}${rr.toFixed(2)}R`;
}

function fmtTime(iso: string, tz: string): string {
  const { h, mi } = zonedParts(new Date(iso).getTime(), tz);
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}
