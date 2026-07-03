"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Send } from "lucide-react";

type Msg = { id: string; authorRole: string; message: string; createdAt: string };
type UserInfo = { email: string | null; name: string | null };

export default function AdminSupportThread({ userId }: { userId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/support/${userId}`);
    if (res.ok) {
      const d = await res.json();
      setMessages(d.messages ?? []);
      setUser(d.user ?? null);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`/api/admin/support/${userId}`);
      if (!alive) return;
      if (res.ok) {
        const d = await res.json();
        if (alive) {
          setMessages(d.messages ?? []);
          setUser(d.user ?? null);
        }
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const message = text.trim();
    if (!message) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/support/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (res.ok) {
        setText("");
        await load();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Ошибка отправки");
      }
    } catch {
      setError("Ошибка отправки");
    } finally {
      setSending(false);
    }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString("ru-RU");

  return (
    <div>
      <Link href="/admin/support" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg mb-4">
        <ArrowLeft size={16} /> Все обращения
      </Link>
      <h1 className="text-xl font-semibold">{user?.email ?? userId}</h1>
      {user?.name && <p className="text-sm text-muted">{user.name}</p>}

      <div className="card mt-4 flex flex-col" style={{ height: "60vh" }}>
        <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          {loading ? (
            <div className="text-sm text-faint">Загрузка…</div>
          ) : messages.length === 0 ? (
            <div className="text-sm text-faint">Сообщений пока нет.</div>
          ) : (
            messages.map((m) => {
              const mine = m.authorRole === "admin";
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      mine ? "bg-accent text-white" : "bg-surface-2 text-fg"
                    }`}
                  >
                    {m.message}
                    <div className={`text-[10px] mt-1 ${mine ? "text-white/70" : "text-faint"}`}>{fmt(m.createdAt)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="p-3 border-t border-border shrink-0">
          {error && <div className="mb-2 text-sm text-loss">{error}</div>}
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              maxLength={4000}
              className="input-base flex-1 resize-none"
              placeholder="Ваш ответ…"
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
              title="Отправить"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
