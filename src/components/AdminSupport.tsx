"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";

type Thread = {
  userId: string;
  lastMessage: string;
  lastAt: string;
  lastAuthorRole: string;
  email: string | null;
  name: string | null;
  unread: number;
};

export default function AdminSupport() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/admin/support");
      if (res.ok && alive) setThreads((await res.json()).threads ?? []);
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
      {threads.length === 0 ? (
        <div className="card p-10 text-center text-muted">
          <Mail size={24} className="mx-auto mb-2 text-faint" />
          Сообщений пока нет.
        </div>
      ) : (
        <div className="card divide-y divide-border overflow-hidden">
          {threads.map((th) => (
            <Link
              key={th.userId}
              href={`/admin/support/${th.userId}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2 transition"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium truncate">{th.email ?? th.userId}</span>
                  {th.unread > 0 && (
                    <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-loss text-white text-[10px] font-semibold leading-[18px] text-center">
                      {th.unread}
                    </span>
                  )}
                </div>
                <div className="text-xs text-faint truncate mt-0.5">
                  {th.lastAuthorRole === "admin" ? "Вы: " : ""}
                  {th.lastMessage}
                </div>
              </div>
              <span className="text-xs text-faint shrink-0">{fmt(th.lastAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
