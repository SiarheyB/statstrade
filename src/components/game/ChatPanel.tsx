"use client";

// Чат мира: три канала — общий зал, разговоры про инструменты и закрытый
// канал фонда.
//
// Главное здесь не переписка, а ИДЕЯ С ГРАФИКОМ: к сообщению прикладывается
// инструмент, таймфрейм и своя разметка, и собеседник открывает ровно то же,
// что видит автор. Это возможно только потому, что рынок общий — раньше,
// когда цены считал каждый браузер, показывать друг другу уровни было
// бессмысленно.
import { useCallback, useEffect, useRef, useState } from "react";
import { LineChart, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { fetchChat, sendChat, type ChatMessage } from "@/lib/game/worldClient";
import type { GameDrawing } from "@/engine/entities/types";

const CHANNELS = ["general", "market", "fund"] as const;
type Channel = (typeof CHANNELS)[number];

export default function ChatPanel({
  inFund,
  currentAssetId,
  currentSymbol,
  drawings,
  onOpenIdea,
}: {
  inFund: boolean;
  currentAssetId: string | undefined;
  currentSymbol: string;
  drawings: GameDrawing[];
  // Клик по чужой идее открывает её инструмент в терминале.
  onOpenIdea: (assetId: string) => void;
}) {
  const { t } = useI18n();
  const [channel, setChannel] = useState<Channel>("general");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [attachIdea, setAttachIdea] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (target: Channel) => {
    const list = await fetchChat(target);
    setMessages(list);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await fetchChat(channel);
      if (alive) setMessages(list);
    })();
    // Чат обновляется сам: разговор, который приходится обновлять руками,
    // разговором быть перестаёт.
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void load(channel);
    }, 8000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [channel, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function submit() {
    const value = text.trim();
    if (value.length === 0) return;
    setBusy(true);
    setError(null);
    const result = await sendChat({
      channel,
      text: value,
      assetId: attachIdea ? (currentAssetId ?? null) : null,
      tf: null,
      drawings: attachIdea && drawings.length > 0 ? drawings : undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setText("");
    setAttachIdea(false);
    await load(channel);
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-0.5">
          {CHANNELS.map((name) => (
            <button
              key={name}
              type="button"
              disabled={name === "fund" && !inFund}
              onClick={() => setChannel(name)}
              title={name === "fund" && !inFund ? t("game.chat.fundLocked") : undefined}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition disabled:opacity-40 ${
                channel === name ? "bg-accent text-white" : "text-muted hover:text-fg"
              }`}
            >
              {t(`game.chat.channel.${name}`)}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-faint">{t("game.chat.hint")}</span>
      </div>

      <div className="h-[320px] overflow-y-auto space-y-2 pr-1">
        {messages.length === 0 && <div className="text-xs text-faint">{t("game.chat.empty")}</div>}
        {messages.map((message) => (
          <div key={message.id} className="text-sm">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{message.author.nickname}</span>
              <span className="text-[11px] text-accent">{t(`game.shop.rank.${message.author.rankKey}`)}</span>
              <span className="ml-auto text-[11px] text-faint tabular-nums">
                {new Date(message.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <div className="text-muted">{message.text}</div>
            {message.assetId && (
              <button
                type="button"
                onClick={() => onOpenIdea(message.assetId!)}
                className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-accent/10 px-2 py-1 text-[11px] text-accent hover:bg-accent/20"
              >
                <LineChart size={12} />
                {t("game.chat.openIdea", { asset: message.assetId })}
              </button>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            value={text}
            maxLength={400}
            placeholder={t("game.chat.placeholder")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            className="input-base flex-1 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || text.trim().length === 0}
            onClick={() => void submit()}
            className="px-3 py-2 rounded-lg bg-accent text-white disabled:opacity-40"
          >
            <Send size={14} />
          </button>
        </div>

        <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={attachIdea}
            disabled={!currentAssetId}
            onChange={(e) => setAttachIdea(e.target.checked)}
            className="accent-accent"
          />
          {t("game.chat.attach", { symbol: currentSymbol || "—", count: drawings.length })}
        </label>

        {error && <div className="text-xs text-loss">{error}</div>}
      </div>
    </div>
  );
}
