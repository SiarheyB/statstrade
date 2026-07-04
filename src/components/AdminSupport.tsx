"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";

type Ticket = {
  id: string;
  userId: string;
  subject: string;
  status: string; // open | closed
  lastMessageAt: string;
  lastMessage: string | null;
  lastAuthorRole: string | null;
  email: string | null;
  name: string | null;
  unread: number;
};

// Инбокс тикетов: открытые сверху. Клик — тред тикета.
export default function AdminSupport() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/admin/support");
      if (res.ok && alive) setTickets((await res.json()).tickets ?? []);
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const fmt = (iso: string) => new Date(iso).toLocaleString("ru-RU");

  if (loading) return <div className="mt-6 text-sm text-faint">Загрузка…</div>;

  return (
    <div className="mt-6">
      {tickets.length === 0 ? (
        <div className="card p-10 text-center text-muted">
          <Mail size={24} className="mx-auto mb-2 text-faint" />
          Обращений пока нет.
        </div>
      ) : (
        <div className="card divide-y divide-border overflow-hidden">
          {tickets.map((tk) => (
            <Link
              key={tk.id}
              href={`/admin/support/${tk.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2 transition"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span
                    className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      tk.status === "open" ? "bg-accent-soft text-accent" : "bg-surface-2 text-faint"
                    }`}
                  >
                    {tk.status === "open" ? "Открыт" : "Закрыт"}
                  </span>
                  <span className="font-medium truncate">{tk.subject}</span>
                  {tk.unread > 0 && (
                    <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-loss text-white text-[10px] font-semibold leading-[18px] text-center">
                      {tk.unread}
                    </span>
                  )}
                </div>
                <div className="text-xs text-faint truncate mt-0.5">
                  {tk.email ?? tk.userId}
                  {tk.lastMessage != null && (
                    <>
                      {" · "}
                      {tk.lastAuthorRole === "admin" ? "Вы: " : ""}
                      {tk.lastMessage}
                    </>
                  )}
                </div>
              </div>
              <span className="text-xs text-faint shrink-0">{fmt(tk.lastMessageAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
