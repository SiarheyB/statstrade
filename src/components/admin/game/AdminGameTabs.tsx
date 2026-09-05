"use client";

// Админка игры, разделённая по разделам.
//
// Всё висело одной страницей: статистика, тумблеры доступа, восемь настроек
// баланса, чат и таблица игроков подряд — чтобы дойти до нужного, страницу
// приходилось прокручивать целиком, и каждый раз заново искать глазами, где
// что. Разделы отвечают на разные вопросы и живут отдельно.
//
// Данные грузятся ОДИН раз на все вкладки: разделение страницы не должно
// превращаться в пять походов на сервер за одним и тем же набором цифр.
import { useEffect, useState } from "react";
import { BarChart3, MessagesSquare, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";
import AdminGameConfig from "@/components/AdminGameConfig";
import GameOverview from "./GameOverview";
import GameChatModeration from "./GameChatModeration";
import GamePlayers from "./GamePlayers";
import type { GameStats } from "./types";

const TABS = [
  { id: "overview", label: "Обзор", Icon: BarChart3 },
  { id: "players", label: "Игроки", Icon: Users },
  { id: "chat", label: "Чат", Icon: MessagesSquare },
  { id: "access", label: "Доступ", Icon: ShieldCheck },
  { id: "balance", label: "Баланс", Icon: SlidersHorizontal },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function AdminGameTabs() {
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<GameStats | null>(null);
  const [error, setError] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/admin/game");
      if (!alive) return;
      if (!res.ok) {
        setError(true);
        return;
      }
      setStats((await res.json()) as GameStats);
      setLoadedAt(Date.now());
    })();
    return () => {
      alive = false;
    };
  }, []);

  const needsStats = tab === "overview" || tab === "players" || tab === "chat";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1 card p-1 w-fit">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === id ? "bg-accent text-white" : "text-muted hover:text-fg"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {needsStats && error && <div className="text-sm text-loss">Не удалось загрузить статистику</div>}
      {needsStats && !stats && !error && <div className="text-xs text-faint">Загрузка…</div>}

      {tab === "overview" && stats && <GameOverview stats={stats} />}
      {tab === "players" && stats && <GamePlayers stats={stats} />}
      {tab === "chat" && stats && <GameChatModeration stats={stats} loadedAt={loadedAt} />}
      {tab === "access" && <AdminGameConfig section="access" />}
      {tab === "balance" && <AdminGameConfig section="balance" />}
    </div>
  );
}
