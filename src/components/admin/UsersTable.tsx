"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, Trash2, KeyRound } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";

type Row = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  online: boolean;
  lastSeenAt: string | null;
  twoFactorEnabled: boolean;
  google: boolean;
  accounts: number;
  annotations: number;
  isAdmin: boolean;
};

export default function UsersTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const nf = locale === "ru" ? "ru-RU" : "en-US";
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const filtered = rows.filter(
    (r) => r.email.toLowerCase().includes(q.toLowerCase()) || (r.name ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  async function reset2fa(r: Row) {
    if (!confirm(t("admin.users.confirmReset2fa", { email: r.email }))) return;
    setBusy(r.id);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: r.id, action: "reset2fa" }),
      });
      const json = await res.json();
      if (!res.ok) alert(json.error ?? t("admin.users.error"));
      else router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(r: Row) {
    if (!confirm(t("admin.users.confirmDelete", { email: r.email }))) return;
    setBusy(r.id);
    try {
      const res = await fetch(`/api/admin/users?id=${r.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) alert(json.error ?? t("admin.users.error"));
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
        placeholder={t("admin.users.search")}
        className="w-full max-w-sm mb-4 px-3 py-2 rounded-lg bg-surface border border-border text-sm focus:outline-none focus-visible:ring-2 ring-accent"
      />
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-faint border-b border-border">
                <th className="px-5 py-2 font-medium">{t("admin.users.th.email")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.users.th.name")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.users.th.status")}</th>
                <th className="px-3 py-2 font-medium text-right">{t("admin.users.th.accounts")}</th>
                <th className="px-3 py-2 font-medium text-right">{t("admin.users.th.annotations")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.users.th.2fa")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.users.th.registered")}</th>
                <th className="px-3 py-2 font-medium">{t("admin.users.th.lastActive")}</th>
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
                  <td
                    className="px-3 py-2.5 whitespace-nowrap"
                    title={r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleString(nf) : undefined}
                  >
                    {r.online ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-profit">
                        <span className="h-1.5 w-1.5 rounded-full bg-profit" /> {t("admin.users.online")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-faint">
                        <span className="h-1.5 w-1.5 rounded-full bg-faint/50" /> {t("admin.users.offline")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.accounts}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">{r.annotations}</td>
                  <td className="px-3 py-2.5">
                    {r.twoFactorEnabled ? (
                      <span className="inline-flex items-center gap-1 text-profit text-xs"><KeyRound size={12} /> {t("admin.users.2faOn")}</span>
                    ) : (
                      <span className="text-faint text-xs">{t("admin.dash")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleDateString(nf)}
                  </td>
                  <td className="px-3 py-2.5 text-muted whitespace-nowrap">
                    {r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleString(nf) : t("admin.dash")}
                  </td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap">
                    <div className="inline-flex gap-1">
                      {r.twoFactorEnabled && (
                        <button
                          onClick={() => reset2fa(r)}
                          disabled={busy === r.id}
                          title={t("admin.users.reset2faTitle")}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted hover:text-fg hover:bg-surface-2 transition disabled:opacity-50"
                        >
                          <KeyRound size={13} /> {t("admin.users.reset2fa")}
                        </button>
                      )}
                      <button
                        onClick={() => remove(r)}
                        disabled={busy === r.id || r.isAdmin}
                        title={r.isAdmin ? t("admin.users.deleteAdminTitle") : t("admin.users.deleteTitle")}
                        className={clsx(
                          "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md transition",
                          r.isAdmin ? "text-faint cursor-not-allowed" : "text-muted hover:text-loss hover:bg-surface-2",
                        )}
                      >
                        <Trash2 size={13} /> {t("admin.users.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted">{t("admin.users.none")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
