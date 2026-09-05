"use client";

// Игроки. Строка — ссылка в карточку пользователя: игрок в мире и
// пользователь проекта это одно лицо, и разбираться с ним админ приходит
// оттуда — там и почта, и вход, и всё остальное.
import Link from "next/link";
import { money, type GameStats } from "./types";

export default function GamePlayers({ stats }: { stats: GameStats }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Игроки</h2>
        <p className="mt-1 text-sm text-muted">
          По числу пройденных испытаний, затем по престижу. Нажмите на строку — откроется карточка
          пользователя с игровым профилем, который можно править.
        </p>
      </div>

      <div className="card p-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
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
              <tr key={p.userId} className="border-t border-border hover:bg-surface-2 transition">
                <td className="py-1.5">
                  <Link href={`/admin/users/${p.userId}`} className="text-accent hover:underline">
                    {p.nickname}
                  </Link>
                </td>
                <td className="text-muted">{p.rankKey}</td>
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
    </section>
  );
}
