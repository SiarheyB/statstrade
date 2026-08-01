"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, CircleX, AlertTriangle, Wifi, WifiOff, HelpCircle } from "lucide-react";
import clsx from "clsx";

function Hint({ text }: { text: string }) {
  return (
    <span title={text} className="inline-flex cursor-help">
      <HelpCircle size={12} className="text-faint shrink-0" />
    </span>
  );
}

// Раздел «Форекс» админ-панели. Опрашивает /api/admin/forex раз в несколько
// секунд: статус forex-collector (Finnhub WS + Twelve Data) и факт записи
// в FxCandle по каждой паре/таймфрейму.

const POLL_MS = 5000;
// Свежесть свечи таймфрейма X считается нормальной, если last_t не старше
// 3×длины свечи (запас на паузы рынка/сети) — иначе помечаем как отставание.
const INTERVAL_MS: Record<string, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

type HealthData = {
  healthy: boolean;
  uptimeMs: number;
  instruments: number;
  symbols?: string[];
  backfillDone: boolean;
  ws: { connected: boolean; reconnects: number; totalTrades: number; lastTradeAt: string | null };
  twelveData: { apiKeySet: boolean; totalCalls: number; fallbackIntervalSec: number };
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

  const now = data ? Date.parse(data.now) : Date.now();
  const h = data?.health;
  const online = h?.ok && h.data?.healthy;
  const wsOk = h?.ok && h.data?.ws.connected;

  // Пары, у которых свежая свеча самого мелкого таймфрейма (5m) сильно
  // отстаёт — вероятный признак проблемы с этой конкретной парой.
  const staleSymbols = data
    ? data.symbols.filter((s) => {
        const cell = data.bySymbol[s]?.["5m"];
        if (!cell?.lastT) return true;
        return now - Date.parse(cell.lastT) > INTERVAL_MS["5m"] * 3;
      })
    : [];

  return (
    <div className="mt-6 space-y-6">
      {error && (
        <div className="card p-4 border-loss/40 text-sm text-loss">Ошибка загрузки: {error}</div>
      )}

      {staleSymbols.length > 0 && (
        <div className="card p-4 border-loss/40 flex items-start gap-3 text-sm">
          <AlertTriangle size={18} className="text-loss shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-loss flex items-center gap-1.5">
              {staleSymbols.length} из {data?.symbols.length ?? 0} пар(ы) не обновляются на 5m {">"}15 мин
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
              {wsOk ? <Wifi size={14} className="text-profit" /> : <WifiOff size={14} className="text-loss" />}
              Finnhub WS: {wsOk ? "подключён" : "отключён"}
              {h.data.ws.reconnects > 0 && ` (реконнектов: ${h.data.ws.reconnects})`}
              <Hint text="Finnhub WebSocket — основной источник тиков (сделок) в реальном времени. «Отключён» или частые реконнекты — тики не приходят живьём, свежие свечи не наполняются, но история дозагружается через Twelve Data." />
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
              Twelve Data: {h.data.twelveData.apiKeySet ? `${h.data.twelveData.totalCalls} запросов` : "ключ не задан"}
              <Hint text="Twelve Data — резервный REST-источник: докачивает историю (бэкафилл) и подстраховывает, если WS не даёт свежих тиков. Число — сколько запросов к его API сделано с запуска." />
            </span>
            <span className="text-muted flex items-center gap-1">
              бэкафилл: {h.data.backfillDone ? "завершён" : "идёт…"}
              <Hint text="Первоначальная догрузка исторических свечей через Twelve Data при старте коллектора. Пока «идёт…» — таблица свечей ниже может быть неполной." />
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
            <Hint text="Для каждой пары и таймфрейма: слева — сколько всего свечей сохранено в БД, справа после «·» — сколько времени прошло с последней (самой свежей) свечи. Красным помечены ячейки, где последняя свеча отстаёт больше чем на 3× длины своей свечи (например, для 1h — больше 3 часов)." />
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
              {data.symbols.map((symbol) => (
                <tr key={symbol} className="border-b border-border/20">
                  <td className="py-1 pr-4 font-medium">{symbol}</td>
                  {data.intervals.map((iv) => {
                    const cell = data.bySymbol[symbol]?.[iv];
                    if (!cell) return <td key={iv} className="py-1 pr-4 text-right text-faint">—</td>;
                    const ago = agoLabel(cell.lastT, now);
                    const expectedMs = INTERVAL_MS[iv] ?? 0;
                    const stale = ago.ms > expectedMs * 3;
                    return (
                      <td key={iv} className={clsx("py-1 pr-4 text-right", stale ? "text-loss" : "text-muted")}>
                        {cell.count} <span className="text-faint">· {ago.text}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
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
