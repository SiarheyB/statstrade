"use client";

// Статистика игры «Свечник» для админки: люди, деньги, рынок, займы, фонды.
// До этого про игру не было видно вообще ничего, кроме двух тумблеров
// доступа — нельзя было понять ни сколько людей играет, ни живой ли мир.
import { useEffect, useState } from "react";

type Stats = {
  players: {
    total: number;
    activeDay: number;
    activeWeek: number;
    avgEquity: number;
    maxEquity: number;
    totalEquity: number;
    avgReliability: number;
    avgLevel: number;
    contractsPassed: number;
    bestContractPct: number;
    byStyle: { style: string; count: number }[];
    byRank: { rank: string; count: number }[];
  };
  top: {
    nickname: string;
    rankKey: string;
    prestige: number;
    level: number;
    equity: number;
    contractsPassed: number;
    bestContractPct: number;
    reliability: number;
    activeStyle: string;
    lastSyncAt: string;
  }[];
  funds: { name: string; capital: number; feePct: number; owner: string; members: number; createdAt: string }[];
  loans: { total: number; volume: number; byStatus: { status: string; count: number; amount: number }[] };
  market: {
    seed: string | null;
    startedAt: string | null;
    candles: number;
    news: number;
    assetsTotal: number;
    assetsGenerated: number;
    daysGenerated: number;
  };
  worldEventsWeek: number;
};

const money = (value: number) =>
  `${Math.round(value).toLocaleString("ru-RU")} $`;

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

export default function AdminGameStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/admin/game");
      if (!alive) return;
      if (!res.ok) {
        setError(true);
        return;
      }
      setStats((await res.json()) as Stats);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <div className="text-sm text-loss">Не удалось загрузить статистику</div>;
  if (!stats) return <div className="text-xs text-faint">Загрузка…</div>;

  const { players, market, loans } = stats;

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">Статистика</h2>
        <p className="mt-1 text-sm text-muted">
          Игроки, деньги и состояние общего рынка. Обновляется при открытии страницы.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Игроков" value={String(players.total)} hint={`за сутки ${players.activeDay}, за неделю ${players.activeWeek}`} />
        <Metric label="Средняя эквити" value={money(players.avgEquity)} hint={`максимум ${money(players.maxEquity)}`} />
        <Metric label="Капитал в игре" value={money(players.totalEquity)} hint="сумма по всем игрокам" />
        <Metric label="Испытаний пройдено" value={String(players.contractsPassed)} hint={`лучший результат +${players.bestContractPct.toFixed(1)}%`} />
        <Metric label="Средний уровень" value={players.avgLevel.toFixed(1)} />
        <Metric label="Кредитная репутация" value={players.avgReliability.toFixed(0)} hint="в среднем по игрокам" />
        <Metric label="Займов" value={String(loans.total)} hint={`объём ${money(loans.volume)}`} />
        <Metric label="Событий за неделю" value={String(stats.worldEventsWeek)} hint="лента мира" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="text-sm font-medium mb-2">Во что играют</div>
          <div className="space-y-1 text-sm">
            {players.byStyle.map((row) => (
              <div key={row.style} className="flex justify-between">
                <span className="text-muted">{row.style}</span>
                <span className="tabular-nums">{row.count}</span>
              </div>
            ))}
            {players.byStyle.length === 0 && <div className="text-xs text-faint">Пока никто не играл</div>}
          </div>
        </div>

        <div className="card p-4">
          <div className="text-sm font-medium mb-2">Ранги</div>
          <div className="space-y-1 text-sm">
            {players.byRank.map((row) => (
              <div key={row.rank} className="flex justify-between">
                <span className="text-muted">{row.rank}</span>
                <span className="tabular-nums">{row.count}</span>
              </div>
            ))}
            {players.byRank.length === 0 && <div className="text-xs text-faint">—</div>}
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="text-sm font-medium mb-2">Рынок</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-[11px] text-muted">Свечей в базе</div>
            <div className="tabular-nums">{market.candles.toLocaleString("ru-RU")}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">Новостей</div>
            <div className="tabular-nums">{market.news.toLocaleString("ru-RU")}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">Инструментов с историей</div>
            <div className="tabular-nums">
              {market.assetsGenerated} / {market.assetsTotal}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted">Самая длинная история</div>
            <div className="tabular-nums">{market.daysGenerated} дн.</div>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-faint">
          Мир создан {market.startedAt ? new Date(market.startedAt).toLocaleDateString("ru-RU") : "—"}, сид {market.seed ?? "—"}.
          История генерируется лениво: инструмент получает её, когда его впервые открывают.
        </div>
      </div>

      <div className="card p-4 overflow-x-auto">
        <div className="text-sm font-medium mb-2">Топ игроков</div>
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted">
              <th className="text-left font-medium py-1">Игрок</th>
              <th className="text-left font-medium">Ранг</th>
              <th className="text-left font-medium">Стиль</th>
              <th className="text-right font-medium">Испытаний</th>
              <th className="text-right font-medium">Престиж</th>
              <th className="text-right font-medium">Уровень</th>
              <th className="text-right font-medium">Репутация</th>
              <th className="text-right font-medium">Эквити</th>
              <th className="text-right font-medium">Последний вход</th>
            </tr>
          </thead>
          <tbody>
            {stats.top.map((p) => (
              <tr key={p.nickname} className="border-t border-border">
                <td className="py-1.5">{p.nickname}</td>
                <td className="text-accent">{p.rankKey}</td>
                <td className="text-muted">{p.activeStyle}</td>
                <td className="text-right tabular-nums">{p.contractsPassed}</td>
                <td className="text-right tabular-nums">{p.prestige}</td>
                <td className="text-right tabular-nums">{p.level}</td>
                <td className={`text-right tabular-nums ${p.reliability < 50 ? "text-loss" : ""}`}>{p.reliability}</td>
                <td className="text-right tabular-nums">{money(p.equity)}</td>
                <td className="text-right text-faint">{new Date(p.lastSyncAt).toLocaleString("ru-RU")}</td>
              </tr>
            ))}
            {stats.top.length === 0 && (
              <tr>
                <td colSpan={9} className="py-2 text-xs text-faint">
                  Пока никто не играл
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="text-sm font-medium mb-2">Фонды</div>
          <div className="space-y-1 text-sm">
            {stats.funds.map((f) => (
              <div key={f.name} className="flex items-center gap-2 border-t border-border pt-1.5">
                <span className="font-medium">{f.name}</span>
                <span className="text-xs text-faint">{f.owner} · участников {f.members}</span>
                <span className="ml-auto tabular-nums">{money(f.capital)}</span>
              </div>
            ))}
            {stats.funds.length === 0 && <div className="text-xs text-faint">Фондов пока нет</div>}
          </div>
        </div>

        <div className="card p-4">
          <div className="text-sm font-medium mb-2">Займы по состоянию</div>
          <div className="space-y-1 text-sm">
            {loans.byStatus.map((row) => (
              <div key={row.status} className="flex justify-between border-t border-border pt-1.5">
                <span className="text-muted">{row.status}</span>
                <span className="tabular-nums">
                  {row.count} · {money(row.amount)}
                </span>
              </div>
            ))}
            {loans.byStatus.length === 0 && <div className="text-xs text-faint">Займов пока не было</div>}
          </div>
        </div>
      </div>
    </section>
  );
}
