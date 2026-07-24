"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LifeBuoy, X, Send, Plus, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import clsx from "clsx";

type Ticket = {
  id: string;
  subject: string;
  status: string; // open | closed
  lastMessageAt: string;
  unread: number;
};
type Msg = { id: string; authorRole: string; message: string; createdAt: string };

const POLL_MS = 30_000;

// Кнопка «Поддержка» в меню + модалка с тикетами: список обращений → тред
// выбранного тикета. Один вопрос = один тикет; закрытый тикет read-only,
// новый вопрос — кнопка «Новое обращение».
export default function SupportButton({ onOpen, collapsed }: { onOpen?: () => void; collapsed?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [view, setView] = useState<"list" | "thread" | "new">("list");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Точка-индикатор непрочитанного ответа, опрос раз в 30с (лёгкий эндпоинт).
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/support/unread");
        if (res.ok && alive) setHasUnread(((await res.json()).count ?? 0) > 0);
      } catch {
        // тихо игнорируем
      }
    };
    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/support");
      if (res.ok) setTickets((await res.json()).tickets ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const openTicket = useCallback(async (tk: Ticket) => {
    setTicket(tk);
    setView("thread");
    setLoading(true);
    try {
      const res = await fetch(`/api/support/${tk.id}`);
      if (res.ok) {
        const d = await res.json();
        setMessages(d.messages ?? []);
        setTicket(d.ticket ?? tk);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  function openModal() {
    onOpen?.();
    setOpen(true);
    setView("list");
    setError(null);
    loadTickets();
  }
  function close() {
    setOpen(false);
    setError(null);
    setText("");
  }
  function backToList() {
    setView("list");
    setTicket(null);
    setMessages([]);
    setError(null);
    loadTickets();
  }

  useEffect(() => {
    if (open && view === "thread") listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, view, messages]);

  // Отправка: в режиме "new" создаёт тикет, в треде — отвечает в него.
  async function send() {
    const message = text.trim();
    if (!message) return;
    setSending(true);
    setError(null);
    try {
      const url = view === "new" ? "/api/support" : `/api/support/${ticket!.id}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (res.ok) {
        setText("");
        if (view === "new") {
          const d = await res.json();
          await openTicket(d.ticket);
        } else {
          await openTicket(ticket!);
        }
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? t("support.error"));
      }
    } catch {
      setError(t("support.error"));
    } finally {
      setSending(false);
    }
  }

  // «Проблема решена» — пользователь закрывает свой тикет.
  async function resolve() {
    if (!ticket) return;
    const res = await fetch(`/api/support/${ticket.id}`, { method: "PATCH" });
    if (res.ok) {
      const d = await res.json();
      setTicket(d.ticket);
      loadTickets();
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  const isClosed = ticket?.status === "closed";
  const showComposer = view === "new" || (view === "thread" && !isClosed);

  return (
    <>
      <button
        onClick={openModal}
        className={clsx("relative flex w-full items-center py-2 rounded-lg text-sm text-muted hover:text-accent hover:bg-surface-2 transition", collapsed ? "px-1.5 gap-0" : "px-3 gap-3")}
        title={collapsed ? t("nav.support") : undefined}
      >
        <span className="relative inline-flex">
          <LifeBuoy size={18} />
          {hasUnread && <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-accent" />}
        </span>
        <span className={clsx("transition-opacity duration-300", collapsed ? "opacity-0 w-0 overflow-hidden" : "")}>{t("nav.support")}</span>
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/70" onClick={close} />
          <div
            className="relative w-full max-w-md p-0 flex flex-col rounded-[0.85rem] border border-border-strong bg-surface shadow-2xl"
            style={{ maxHeight: "80vh" }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <h2 className="text-lg font-semibold flex items-center gap-2 min-w-0">
                {view !== "list" ? (
                  <button onClick={backToList} className="text-faint hover:text-fg shrink-0" aria-label="back">
                    <ArrowLeft size={18} />
                  </button>
                ) : (
                  <LifeBuoy size={18} className="text-accent shrink-0" />
                )}
                <span className="truncate">
                  {view === "list" ? t("support.title") : view === "new" ? t("support.new") : ticket?.subject}
                </span>
              </h2>
              <button onClick={close} className="text-faint hover:text-fg shrink-0" aria-label="close">
                <X size={18} />
              </button>
            </div>

            {view === "list" ? (
              <div className="flex-1 overflow-y-auto min-h-[200px]">
                {loading ? (
                  <div className="px-5 py-4 text-sm text-faint">{t("common.loading")}</div>
                ) : tickets.length === 0 ? (
                  <div className="px-5 py-4 text-sm text-muted">{t("support.subtitle")}</div>
                ) : (
                  <div className="divide-y divide-border">
                    {tickets.map((tk) => (
                      <button
                        key={tk.id}
                        onClick={() => openTicket(tk)}
                        className="w-full text-left px-5 py-3 hover:bg-surface-2 transition"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              tk.status === "open"
                                ? "bg-accent-soft text-accent"
                                : "bg-surface-2 text-faint"
                            }`}
                          >
                            {tk.status === "open" ? t("support.open") : t("support.closed")}
                          </span>
                          <span className="text-sm truncate flex-1">{tk.subject}</span>
                          {tk.unread > 0 && (
                            <span className="shrink-0 h-2 w-2 rounded-full bg-accent" />
                          )}
                        </div>
                        <div className="text-[11px] text-faint mt-0.5">{fmt(tk.lastMessageAt)}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-2 min-h-[200px]">
                {view === "new" ? (
                  <div className="text-sm text-muted">{t("support.subtitle")}</div>
                ) : loading ? (
                  <div className="text-sm text-faint">{t("common.loading")}</div>
                ) : (
                  messages.map((m) => {
                    const mine = m.authorRole === "user";
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                            mine ? "bg-accent text-white" : "bg-surface-2 text-fg"
                          }`}
                        >
                          {!mine && <div className="text-[10px] font-medium text-accent mb-0.5">{t("support.team")}</div>}
                          {m.message}
                          <div className={`text-[10px] mt-1 ${mine ? "text-white/70" : "text-faint"}`}>{fmt(m.createdAt)}</div>
                        </div>
                      </div>
                    );
                  })
                )}
                {view === "thread" && isClosed && (
                  <div className="text-center text-xs text-faint pt-2">{t("support.closedNote")}</div>
                )}
              </div>
            )}

            <div className="p-3 border-t border-border shrink-0">
              {error && <div className="mb-2 text-sm text-loss">{error}</div>}
              {view === "list" ? (
                <button
                  onClick={() => {
                    setView("new");
                    setError(null);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition text-sm font-medium"
                >
                  <Plus size={16} /> {t("support.new")}
                </button>
              ) : showComposer ? (
                <>
                  <div className="flex items-end gap-2">
                    <textarea
                      rows={2}
                      maxLength={4000}
                      className="input-base flex-1 resize-none"
                      placeholder={t("support.placeholder")}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                    />
                    <button
                      onClick={send}
                      disabled={sending || text.trim().length === 0}
                      className="p-2.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition disabled:opacity-50 shrink-0"
                      title={t("support.send")}
                    >
                      <Send size={16} />
                    </button>
                  </div>
                  {view === "thread" && !isClosed && (
                    <button
                      onClick={resolve}
                      className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs text-muted hover:text-profit hover:bg-surface-2 transition"
                    >
                      <CheckCircle2 size={14} /> {t("support.markResolved")}
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={() => {
                    setView("new");
                    setError(null);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition text-sm font-medium"
                >
                  <Plus size={16} /> {t("support.new")}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
