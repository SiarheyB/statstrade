"use client";

// Обзор игры: люди, деньги, состояние общего рынка.
//
// До этого раздела про игру не было видно вообще ничего, кроме двух тумблеров
// доступа — нельзя было понять ни сколько людей играет, ни живой ли мир.
import { useState } from "react";
import { money, type GameStats } from "./types";

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

export default function GameOverview({ stats }: { stats: GameStats }) {
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<string | null>(null);
  const { players, market, loans } = stats;

  async function rebuild() {
    setRebuilding(true);
    setRebuildResult(null);
    try {
      const res = await fetch("/api/admin/game", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "rebuildMarket" }),
      });
      const data = await res.json();
      setRebuildResult(
        res.ok
          ? `Удалено свечей: ${data.removedCandles}, новостей: ${data.removedNews}. История построится заново.`
          : (data.error ?? "Не удалось пересобрать"),
      );
    } catch {
      setRebuildResult("Не удалось пересобрать");
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">Обзор</h2>
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

        <div className="mt-3 border-t border-border pt-3">
          <button
            type="button"
            onClick={rebuild}
            disabled={rebuilding}
            className="input-base px-3 py-1.5 text-xs hover:border-border-strong disabled:opacity-50"
          >
            {rebuilding ? "Пересобираю…" : "Пересобрать рынок"}
          </button>
          <p className="mt-2 text-[11px] text-faint max-w-prose">
            Стирает сгенерированные свечи и новости — они построятся заново при первом же открытии
            инструмента. Прогресс игроков, займы, фонды и сообщения не трогаются. Рынок
            детерминирован (цены считаются из сида и номера бара), поэтому при том же сиде он
            восстановится ТОЧНО ТАКИМ ЖЕ. Нужно, когда старая история перестала соответствовать
            правилам: поменяли волатильность в настройках баланса, добавили расписание торгов,
            завели новый инструмент.
          </p>
          {rebuildResult && <div className="mt-2 text-[11px] text-profit">{rebuildResult}</div>}
        </div>
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
