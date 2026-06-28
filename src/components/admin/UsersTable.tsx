"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, Trash2, KeyRound } from "lucide-react";
import clsx from "clsx";

type Row = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  twoFactorEnabled: boolean;
  google: boolean;
  accounts: number;
  annotations: number;
  isAdmin: boolean;
};

export default function UsersTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const filtered = rows.filter(
    (r) => r.email.toLowerCase().includes(q.toLowerCase()) || (r.name ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  async function reset2fa(r: Row) {
    if (!confirm(`Сбросить 2FA для ${r.email}?`)) return;
    setBusy(r.id);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: r.id, action: "reset2fa" }),
      });
      const json = await res.json();
      if (!res.ok) alert(json.error ?? "Ошибка");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(r: Row) {
    if (!confirm(`Удалить пользователя ${r.email}? Будут удалены все его аккаунты и данные.`)) return;
    setBusy(r.id);
    try {
      const res = await fetch(`/api/admin/users?id=${r.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) alert(json.error ?? "Ошибка");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-6">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск по email или имени…"
        className="w-full max-w-sm mb-4 px-3 py-2 rounded-lg bg-surface border border-border text-sm focus:outline-none focus-visible:ring-2 ring-accent"
      />
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-faint border-b border-border">
                <th className="px-5 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Имя</th>
                <th className="px-3 py-2 font-medium text-right">Аккаунты</th>
                <th className="px-3 py-2 font-medium text-right">Аннотации</th>
                <th className="px-3 py-2 font-medium">2FA</th>
                <th className="px-3 py-2 font-medium">Регистрация</th>
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
                  <td className="px-5 py-2.5 whitespace-nowrap">
                    <Link href={`/admin/users/${r.id}`} className="inline-flex items-center gap-1.5 hover:text-accent transition">
                      {r.isAdmin && <ShieldCheck size={14} className="text-accent" />}
                      {r.email}
                      {r.google && <span className="text-[10px] text-faint">G</span>}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-muted">{r.name ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.accounts}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">{r.annotations}</td>
                  <td className="px-3 py-2.5">
                    {r.twoFactorEnabled ? (
                      <span className="inline-flex items-center gap-1 text-profit text-xs"><KeyRound size={12} /> вкл</span>
                    ) : (
                      <span className="text-faint text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleDateString("ru-RU")}
                  </td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap">
                    <div className="inline-flex gap-1">
                      {r.twoFactorEnabled && (
                        <button
                          onClick={() => reset2fa(r)}
                          disabled={busy === r.id}
                          title="Сбросить 2FA"
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted hover:text-fg hover:bg-surface-2 transition disabled:opacity-50"
                        >
                          <KeyRound size={13} /> 2FA
                        </button>
                      )}
                      <button
                        onClick={() => remove(r)}
                        disabled={busy === r.id || r.isAdmin}
                        title={r.isAdmin ? "Нельзя удалить администратора" : "Удалить"}
                        className={clsx(
                          "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md transition",
                          r.isAdmin ? "text-faint cursor-not-allowed" : "text-muted hover:text-loss hover:bg-surface-2",
                        )}
                      >
                        <Trash2 size={13} /> удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-muted">Никого не найдено.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
