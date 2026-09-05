"use client";

// Модерация чата мира.
//
// Лента делится по каналам: в общем зале, разговорах про рынок и закрытых
// каналах фондов происходит разное, и смотреть их вперемешку — значит не
// увидеть ни одного разговора целиком.
import { useMemo, useState } from "react";
import type { GameStats } from "./types";

// Каналы фондов называются «fund:<id>» — в фильтре они собираются под одну
// кнопку: их столько же, сколько фондов, и отдельная кнопка на каждый
// превратила бы фильтр в список.
const FUND_PREFIX = "fund:";

function channelLabel(channel: string): string {
  if (channel === "general") return "Общий зал";
  if (channel === "market") return "Про рынок";
  if (channel.startsWith(FUND_PREFIX)) return "Фонды";
  return channel;
}

function channelKey(channel: string): string {
  return channel.startsWith(FUND_PREFIX) ? "fund" : channel;
}

export default function GameChatModeration({ stats, loadedAt }: { stats: GameStats; loadedAt: number }) {
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState<Set<string>>(new Set());

  const channels = useMemo(() => {
    const keys = new Set(stats.chat.map((m) => channelKey(m.channel)));
    return ["all", ...Array.from(keys)];
  }, [stats.chat]);

  const rows = filter === "all" ? stats.chat : stats.chat.filter((m) => channelKey(m.channel) === filter);

  // Снятые сообщения и муты держим в локальном наборе, чтобы строка менялась
  // сразу: перезапрашивать всю статистику ради одной снятой реплики —
  // заметная пауза на ровном месте.
  async function moderate(body: Record<string, unknown>, onDone: () => void) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/game", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Чат мира</h2>
        <p className="mt-1 text-sm text-muted max-w-prose">
          Снятое сообщение исчезает из ленты игроков, но остаётся в базе: пропавшая реплика
          выглядит как сбой, и разобраться потом, за что наказали, было бы нечем. Мут — на час и
          со сроком, а не вечный бан: почти всё лечится паузой, а вечная блокировка требует
          ручного снятия, про которое забывают.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {channels.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              filter === key ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-fg"
            }`}
          >
            {key === "all" ? "Все каналы" : key === "fund" ? "Фонды" : channelLabel(key)}
            <span className="ml-1.5 text-[10px] opacity-70">
              {key === "all" ? stats.chat.length : stats.chat.filter((m) => channelKey(m.channel) === key).length}
            </span>
          </button>
        ))}
      </div>

      <div className="card p-4">
        {rows.length === 0 ? (
          <div className="text-xs text-faint">В этом канале пока ничего не написали.</div>
        ) : (
          <div className="space-y-1.5">
            {rows.map((message) => {
              const isRemoved = message.removed || removed.has(message.id);
              const isMuted = muted.has(message.author.id) || (message.author.mutedUntil ?? 0) > loadedAt;
              return (
                <div key={message.id} className="flex items-start gap-2 text-xs border-t border-border pt-1.5">
                  <span className="text-faint tabular-nums w-[52px] shrink-0">
                    {new Date(message.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="text-muted w-[110px] shrink-0 truncate">
                    {message.author.nickname}
                    {isMuted && <span className="text-loss"> · мут</span>}
                  </span>
                  <span className="text-faint w-[86px] shrink-0 truncate">{channelLabel(message.channel)}</span>
                  <span className={`flex-1 ${isRemoved ? "line-through text-faint" : ""}`}>{message.text}</span>
                  <span className="shrink-0 space-x-1">
                    {!isRemoved && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void moderate({ action: "removeMessage", messageId: message.id }, () =>
                            setRemoved((prev) => new Set(prev).add(message.id)),
                          )
                        }
                        className="input-base px-1.5 py-0.5 hover:border-border-strong disabled:opacity-50"
                      >
                        снять
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void moderate(
                          { action: "mutePlayer", playerId: message.author.id, minutes: isMuted ? 0 : 60 },
                          () =>
                            setMuted((prev) => {
                              const next = new Set(prev);
                              if (isMuted) next.delete(message.author.id);
                              else next.add(message.author.id);
                              return next;
                            }),
                        )
                      }
                      className="input-base px-1.5 py-0.5 hover:border-border-strong disabled:opacity-50"
                    >
                      {isMuted ? "снять мут" : "мут"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
