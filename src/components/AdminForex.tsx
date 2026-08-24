"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, CircleX, AlertTriangle, Wifi, WifiOff, HelpCircle, CalendarClock } from "lucide-react";
import clsx from "clsx";
import { isForexMarketClosed } from "@/lib/forexMarket";

function Hint({ text }: { text: string }) {
  return (
    <span title={text} className="inline-flex cursor-help">
      <HelpCircle size={12} className="text-faint shrink-0" />
    </span>
  );
}

// Раздел «Форекс» админ-панели. Опрашивает /api/admin/forex раз в несколько
// секунд: статус forex-collector (три источника — Finnhub WS, Twelve Data,
// Dukascopy) и факт записи в FxCandle по каждой паре/таймфрейму.

const POLL_MS = 5000;
// Свежесть свечи таймфрейма X считается нормальной, если last_t не старше
// 3×длины свечи (запас на паузы рынка/сети) — иначе помечаем как отставание.
const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

type SourceError = { at: string; symbol?: string; interval?: string; message: string };
type HealthData = {
  healthy: boolean;
  uptimeMs: number;
  instruments: number;
  symbols?: string[];
  backfillDone: boolean;
  // Роль источников поменялась: основной — Dukascopy, Finnhub стал резервом.
  // Поля необязательные — коллектор старой версии их не отдаёт.
  primarySource?: string;
  fallbackActive?: boolean;
  ws: { apiKeySet?: boolean; role?: string; active?: boolean; connected: boolean; reconnects: number; totalTrades: number; lastTradeAt: string | null };
  twelveData: { enabled?: boolean; apiKeySet: boolean; totalCalls: number; fallbackIntervalSec: number };
  // Появился вместе с золотом: металлы и история 1m идут из Dukascopy, ключа
  // он не требует (см. collector/forex/dukascopy.mjs). У коллекторов старой
  // версии этого блока в /health нет — отсюда необязательность.
  dukascopy?: {
    symbols: string[];
    pollSec: number;
    totalCalls: number;
    errors: number;
    failStreak?: number;
    lastOkAt: string | null;
    lastError?: SourceError | null;
  };
  // Тиковый опрос: из тиков собирается текущая (ещё не закрытая) минутка.
  // У коллекторов старой версии блока нет.
  ticks?: {
    pollSec: number;
    limit: number;
    totalCalls: number;
    errors: number;
    lastOkAt: string | null;
    lastError?: SourceError | null;
  };
  errors: number;
  lastWriteOkAt: string | null;
  exchange: string;
};
type Health = { ok: boolean; data?: HealthData; error?: string };
type CandleCell = { count: number; lastT: string | null; oldestT: string | null };
type Payload = {
  now: string;
  health: Health;
  symbols: string[];
  intervals: readonly string[];
  bySymbol: Record<string, Record<string, CandleCell>>;
  config: { symbol: string; enabled: boolean; updatedAt: string }[];
  envSymbols: string[];
};

function fmtUptime(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}с`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}мин`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}ч`;
  return `${Math.round(h / 24)}д`;
}

function agoLabel(ts: string | null, now: number): { text: string; ms: number } {
  if (!ts) return { text: "—", ms: Infinity };
  const ms = now - Date.parse(ts);
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return { text: `${sec}с назад`, ms };
  if (sec < 3600) return { text: `${Math.round(sec / 60)}мин назад`, ms };
  if (sec < 86400) return { text: `${Math.round(sec / 3600)}ч назад`, ms };
  return { text: `${Math.round(sec / 86400)}д назад`, ms };
}

export default function AdminForex() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [purging, setPurging] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/forex", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Пара снята со сбора, но её свечи остались в FxCandle — здесь они и
  // убираются, иначе таблица навсегда остаётся с мёртвыми строками.
  const purgeSymbol = useCallback(async (symbol: string) => {
    if (!confirm(`Удалить все свечи ${symbol} из FxCandle? Действие необратимо.`)) return;
    setPurging(symbol);
    try {
      const res = await fetch("/api/admin/forex/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `HTTP ${res.status}`);
      } else {
        await load();
      }
    } finally {
      setPurging(null);
    }
  }, [load]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      await load();
      if (alive) timer.current = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  if (!data && !error) {
    return <div className="mt-6 text-sm text-muted">Загрузка…</div>;
  }

  // То же, что в AdminCollector: локальное «сейчас» только до первого ответа.
  // eslint-disable-next-line react-hooks/purity -- fallback until data arrives
  const now = data ? Date.parse(data.now) : Date.now();
  const h = data?.health;
  const online = h?.ok && h.data?.healthy;
  const wsOk = h?.ok && h.data?.ws.connected;
  // Резерв включается сам, когда основной источник молчит (collector:
  // updateFallbackState). Иконку «WS отключён» в обычном режиме показывать
  // нельзя — это не поломка, а штатное состояние.
  const isFallback = !!h?.data?.fallbackActive;

  // Пары, у которых свежая свеча самого мелкого таймфрейма (5m) сильно
  // отстаёт — вероятный признак проблемы с этой конкретной парой.
  //
  // На закрытом рынке проверка отключается: с вечера пятницы до вечера
  // воскресенья свечей нет ни у одного источника, и раньше админка каждые
  // выходные показывала красное «N из N пар не обновляются». Предупреждение,
  // которое горит по расписанию, перестают читать.
  const marketClosed = isForexMarketClosed(now);

  // Что коллектор реально собирает ПРЯМО СЕЙЧАС. Таблица ниже строится по
  // содержимому FxCandle, а там остаются и пары, снятые со сбора, — их
  // свечи закономерно «отстают» и раньше поднимали тревогу навсегда
  // («6 из 7 пар не обновляются», хотя собирается ровно одна).
  const collected = new Set<string>(
    h?.data?.symbols
      ?? (data?.config.filter((c) => c.enabled).map((c) => c.symbol))
      ?? data?.envSymbols
      ?? [],
  );
  const isCollected = (symbol: string) => collected.size === 0 || collected.has(symbol);
  const staleSymbols = data && !marketClosed
    ? data.symbols.filter((s) => {
        if (!isCollected(s)) return false;
        const cell = data.bySymbol[s]?.["5m"];
        if (!cell?.lastT) return true;
        return now - Date.parse(cell.lastT) > INTERVAL_MS["5m"] * 3;
      })
    : [];
  const droppedSymbols = data ? data.symbols.filter((s) => !isCollected(s)) : [];

  return (
    <div className="mt-6 space-y-6">
      {error && (
        <div className="card p-4 border-loss/40 text-sm text-loss">Ошибка загрузки: {error}</div>
      )}

      {marketClosed && (
        <div className="card p-4 border-border-strong/60 flex items-start gap-3 text-sm text-muted">
          <CalendarClock size={18} className="text-faint shrink-0 mt-0.5" />
          <div className="flex items-center gap-1.5">
            Валютный рынок закрыт — новых свечей не будет до вечера воскресенья
            <Hint text="Форекс торгуется с вечера воскресенья по вечер пятницы (UTC). На выходных отсутствие свежих свечей — норма, а не сбой, поэтому проверка отставания пар на это время отключена." />
          </div>
        </div>
      )}

      {droppedSymbols.length > 0 && (
        <div className="card p-4 border-border-strong/60 flex items-start gap-3 text-sm text-muted">
          <AlertTriangle size={18} className="text-faint shrink-0 mt-0.5" />
          <div>
            <div className="flex items-center gap-1.5">
              В базе остались свечи пар, которые больше не собираются: {droppedSymbols.join(", ")}
              <Hint text="Пара удалена из списка коллектора (или выключена), но её история в FxCandle осталась. На сбор и графики это не влияет — только занимает место. Удалить можно кнопкой «удалить данные» в таблице ниже." />
            </div>
          </div>
        </div>
      )}

      {staleSymbols.length > 0 && (
        <div className="card p-4 border-loss/40 flex items-start gap-3 text-sm">
          <AlertTriangle size={18} className="text-loss shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-loss flex items-center gap-1.5">
              {staleSymbols.length} из {collected.size || data?.symbols.length || 0} пар(ы) не обновляются на 5m {">"}15 мин
              <Hint text="У этих пар нет свежей 5-минутной свечи дольше 15 минут (3× длины свечи — запас на паузы рынка/сети). Обычно значит: коллектор недавно перезапущен и ещё не наверстал данные, либо реально пропали тики от источника (WS отключён / тиков 0)." />
            </div>
            <div className="mt-1 text-muted">{staleSymbols.join(", ")}</div>
          </div>
        </div>
      )}

      {/* Статус коллектора */}
      <div className={clsx("card p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm", online ? "border-profit/30" : "border-loss/30")}>
        <span className="flex items-center gap-2 font-medium">
          {online ? <CircleCheck size={18} className="text-profit" /> : <CircleX size={18} className="text-loss" />}
          forex-collector:{" "}
          {online ? "online" : h?.ok ? "не готов" : "недоступен"}
          <Hint text="Статус самого процесса forex-collector (отдельный сервис): online — процесс жив и здоров; не готов — процесс запущен, но ещё не прошёл проверку здоровья (например, идёт бэкафилл); недоступен — не отвечает на /health вовсе." />
        </span>
        {h?.ok && h.data && (
          <>
            <span className="text-muted flex items-center gap-1">
              uptime: {fmtUptime(h.data.uptimeMs)}
              <Hint text="Сколько времени процесс forex-collector работает без перезапуска." />
            </span>
            <span className="text-muted flex items-center gap-1">
              пар: {h.data.instruments}
              <Hint text="Сколько валютных пар коллектор сейчас отслеживает (подписан на них)." />
            </span>
            <span className="flex items-center gap-1.5 text-muted">
              {wsOk ? <Wifi size={14} className={isFallback ? "text-loss" : "text-profit"} /> : <WifiOff size={14} className={isFallback ? "text-loss" : "text-faint"} />}
              Finnhub WS: {h.data.ws.apiKeySet === false
                ? "ключ не задан"
                : isFallback
                  ? (wsOk ? "ПОДХВАТИЛ (Dukascopy молчит)" : "поднимается…")
                  : "в резерве"}
              {h.data.ws.reconnects > 0 && ` (реконнектов: ${h.data.ws.reconnects})`}
              <Hint text="Finnhub WebSocket — РЕЗЕРВНЫЙ источник тиков по валютным парам. В обычном режиме соединение не поднимается вовсе («в резерве») — данные идут из Dukascopy. «ПОДХВАТИЛ» означает, что основной источник замолчал и коллектор переключился на тики; металлы в этом режиме не обновляются, у Finnhub их нет. «Ключ не задан» — FINNHUB_API_KEY пуст, то есть резерва нет совсем." />
            </span>
            <span className="text-muted flex items-center gap-1">
              тиков: {h.data.ws.totalTrades.toLocaleString("ru-RU")}
              <Hint text="Сколько сделок (тиков) коллектор получил от Finnhub WS с момента запуска. Если WS подключён, но тиков 0 — с сервера реально ничего не приходит (нет активности по подписанным символам или проблема с подпиской)." />
            </span>
            <span className="text-muted flex items-center gap-1">
              последний тик: {agoLabel(h.data.ws.lastTradeAt, now).text}
              <Hint text="Сколько времени прошло с последней полученной сделки от Finnhub WS." />
            </span>
            <span className="text-muted flex items-center gap-1">
              Twelve Data: {h.data.twelveData.enabled === false
                ? "выключен"
                : h.data.twelveData.apiKeySet ? `${h.data.twelveData.totalCalls} запросов` : "ключ не задан"}
              <Hint text="Twelve Data — резерв последней очереди. По умолчанию выключен (FX_TWELVEDATA_ENABLED≠1): историю по всем парам теперь приносит Dukascopy, а бесплатного лимита Twelve Data в 800 запросов/сутки на все пары и таймфреймы не хватало." />
            </span>
            {h.data.dukascopy && (
              <span className={clsx("flex items-center gap-1", h.data.dukascopy.errors > 0 ? "text-loss" : "text-muted")}>
                Dukascopy (основной): {h.data.dukascopy.symbols.length > 0
                  ? `${h.data.dukascopy.symbols.join(", ")} · ${h.data.dukascopy.totalCalls} запросов`
                  : "инструменты не заданы"}
                {h.data.dukascopy.errors > 0 && ` · ошибок: ${h.data.dukascopy.errors}`}
                {h.data.dukascopy.lastError && (
                  <span className="text-faint">
                    (последняя: {h.data.dukascopy.lastError.symbol} {h.data.dukascopy.lastError.interval} — {h.data.dukascopy.lastError.message}, {agoLabel(h.data.dukascopy.lastError.at, now).text})
                  </span>
                )}
                <Hint text="Dukascopy — основной источник данных по ВСЕМ инструментам: и валютным парам, и металлам. Ключ ему не нужен, опрашивается раз в несколько секунд. Здесь: какие инструменты через него собираются, сколько запросов сделано с запуска и сколько из них не удалось. Если он замолчит на несколько циклов подряд, коллектор сам поднимет резервный Finnhub." />
              </span>
            )}
            {h.data.dukascopy && (
              <span className="text-muted flex items-center gap-1">
                последний ответ Dukascopy: {agoLabel(h.data.dukascopy.lastOkAt, now).text}
                <Hint text="Когда Dukascopy в последний раз отдал данные. На закрытом рынке (выходные) время растёт — это норма: новых свечей нет." />
              </span>
            )}
            {h.data.ticks && (
              <span className={clsx("flex items-center gap-1", h.data.ticks.errors > 0 ? "text-loss" : "text-muted")}>
                тики: раз в {h.data.ticks.pollSec}с · {h.data.ticks.totalCalls} запросов
                {h.data.ticks.errors > 0 && ` · ошибок: ${h.data.ticks.errors}`}
                {h.data.ticks.lastError && (
                  <span className="text-faint">
                    (последняя: {h.data.ticks.lastError.symbol} — {h.data.ticks.lastError.message}, {agoLabel(h.data.ticks.lastError.at, now).text})
                  </span>
                )}
                <Hint text="Опрос тиков Dukascopy: из них собирается ТЕКУЩАЯ (ещё не закрытая) минутка, а из неё — текущие бары 5m/15m. Закрытые бары приходят отдельным опросом свечей. Без тиков последняя свеча на минутном графике появлялась бы только после закрытия минуты." />
              </span>
            )}
            <span className="text-muted flex items-center gap-1">
              бэкафилл: {h.data.backfillDone ? "завершён" : "идёт…"}
              <Hint text="Первоначальная догрузка исторической части свечей при старте коллектора (Twelve Data по валютным парам, Dukascopy по металлам и 1m). Пока «идёт…» — таблица свечей ниже может быть неполной." />
            </span>
            {h.data.errors > 0 && (
              <span className="text-loss flex items-center gap-1">
                ошибок записи: {h.data.errors}
                <Hint text="Сколько раз коллектор не смог записать данные в БД с момента запуска." />
              </span>
            )}
          </>
        )}
        {h && !h.ok && <span className="text-loss text-xs">{h.error}</span>}
      </div>

      {/* Матрица пара × таймфрейм */}
      {data && (
        <div className="card p-4 overflow-x-auto">
          <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5">
            Свечи по парам (FxCandle)
            <Hint text="Для каждой пары и таймфрейма: слева — сколько всего свечей сохранено в БД, справа после «·» — сколько времени прошло с последней (самой свежей) свечи. Красным помечены ячейки, где последняя свеча отстаёт больше чем на 3× длины своей свечи (например, для 1h — больше 3 часов). Пары с пометкой «не собирается» сняты со сбора (их нет в списке коллектора) — их свечи просто лежат в БД, отставание для них норма; кнопка «удалить данные» убирает их из FxCandle." />
          </h3>
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-faint text-left border-b border-border/50">
                <th className="font-medium py-1 pr-4">Пара</th>
                {data.intervals.map((iv) => (
                  <th key={iv} className="font-medium py-1 pr-4 text-right">{iv}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.symbols.map((symbol) => {
                const dropped = !isCollected(symbol);
                return (
                  <tr key={symbol} className="border-b border-border/20">
                    <td className="py-1 pr-4 font-medium whitespace-nowrap">
                      <span className={dropped ? "text-faint" : undefined}>{symbol}</span>
                      {dropped && (
                        <>
                          <span className="ml-2 text-[10px] text-faint border border-border/50 rounded px-1 py-px">
                            не собирается
                          </span>
                          <button
                            onClick={() => void purgeSymbol(symbol)}
                            disabled={purging === symbol}
                            title="Удалить свечи этой пары из FxCandle"
                            className="ml-2 text-[10px] text-loss hover:underline disabled:opacity-50"
                          >
                            {purging === symbol ? "удаляю…" : "удалить данные"}
                          </button>
                        </>
                      )}
                    </td>
                    {data.intervals.map((iv) => {
                      const cell = data.bySymbol[symbol]?.[iv];
                      if (!cell) return <td key={iv} className="py-1 pr-4 text-right text-faint">—</td>;
                      const ago = agoLabel(cell.lastT, now);
                      const expectedMs = INTERVAL_MS[iv] ?? 0;
                      // Снятую со сбора пару красным не помечаем: её свечи
                      // отстают по определению, это не поломка.
                      const stale = !dropped && ago.ms > expectedMs * 3;
                      return (
                        <td key={iv} className={clsx("py-1 pr-4 text-right", stale ? "text-loss" : dropped ? "text-faint" : "text-muted")}>
                          {cell.count} <span className="text-faint">· {ago.text}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {data.symbols.length === 0 && (
                <tr><td colSpan={data.intervals.length + 1} className="py-4 text-center text-faint">Данных пока нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
