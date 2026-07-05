"use client";

import { useEffect, useState } from "react";
import { Trash2, AlertTriangle, ChevronDown } from "lucide-react";

type ErrLog = { id: string; message: string; path: string | null; stack: string | null; createdAt: string; readAt: string | null };

export default function AdminErrors() {
  const [errors, setErrors] = useState<ErrLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/admin/errors");
      if (res.ok && alive) setErrors((await res.json()).errors ?? []);
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function remove(id: string) {
    setBusy(id);
    try {
      await fetch("/api/admin/errors", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setErrors((xs) => xs.filter((e) => e.id !== id));
    } finally {
      setBusy(null);
    }
  }

  async function clearAll() {
    if (!confirm("Удалить все записи лога ошибок?")) return;
    setBusy("all");
    try {
      await fetch("/api/admin/errors", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setErrors([]);
    } finally {
      setBusy(null);
    }
  }

  function toggle(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString("ru-RU");

  if (loading) return <div className="mt-6 text-sm text-faint">Загрузка…</div>;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted">Всего записей: {errors.length}</span>
        <button
          onClick={clearAll}
          disabled={errors.length === 0 || busy === "all"}
          className="input-base text-sm py-1.5 px-3 inline-flex items-center gap-1.5 text-loss border-loss/40 hover:border-loss disabled:opacity-40"
        >
          <Trash2 size={14} /> Очистить всё
        </button>
      </div>

      {errors.length === 0 ? (
        <div className="card p-10 text-center text-muted">
          <AlertTriangle size={24} className="mx-auto mb-2 text-faint" />
          Ошибок не зафиксировано.
        </div>
      ) : (
        <div className="space-y-2">
          {errors.map((e) => (
            <div key={e.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm min-w-0">
                    <AlertTriangle size={14} className="text-loss shrink-0" />
                    <span className="font-medium break-all min-w-0">{e.message}</span>
                  </div>
                  <div className="mt-1 text-xs text-faint flex items-center gap-2 flex-wrap">
                    <span>{fmt(e.createdAt)}</span>
                    {e.path && (
                      <>
                        <span>·</span>
                        <span className="font-mono">{e.path}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {e.stack && (
                    <button
                      onClick={() => toggle(e.id)}
                      className="input-base p-1.5 text-muted hover:text-fg"
                      title="Стек вызова"
                    >
                      <ChevronDown size={14} className={expanded.has(e.id) ? "rotate-180 transition" : "transition"} />
                    </button>
                  )}
                  <button
                    onClick={() => remove(e.id)}
                    disabled={busy === e.id}
                    className="input-base p-1.5 text-muted hover:text-loss disabled:opacity-40"
                    title="Удалить"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {e.stack && expanded.has(e.id) && (
                <pre className="mt-2 p-2 rounded-lg bg-surface-2 text-[11px] text-faint overflow-x-auto whitespace-pre-wrap break-all">
                  {e.stack}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
