"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Trash2 } from "lucide-react";
import clsx from "clsx";

export default function UserDetailActions({
  id,
  email,
  isAdmin,
  has2fa,
}: {
  id: string;
  email: string;
  isAdmin: boolean;
  has2fa: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function reset2fa() {
    if (!confirm(`Сбросить 2FA для ${email}?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action: "reset2fa" }),
      });
      const json = await res.json();
      if (!res.ok) alert(json.error ?? "Ошибка");
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Удалить пользователя ${email}? Будут удалены все его аккаунты и данные.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error ?? "Ошибка");
        setBusy(false);
      } else {
        router.push("/admin/users");
        router.refresh();
      }
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      {has2fa && (
        <button
          onClick={reset2fa}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border text-muted hover:text-fg hover:bg-surface-2 transition disabled:opacity-50"
        >
          <KeyRound size={15} /> Сбросить 2FA
        </button>
      )}
      <button
        onClick={remove}
        disabled={busy || isAdmin}
        title={isAdmin ? "Нельзя удалить администратора" : undefined}
        className={clsx(
          "inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition",
          isAdmin
            ? "border-border text-faint cursor-not-allowed"
            : "border-loss/30 text-loss hover:bg-loss/10 disabled:opacity-50",
        )}
      >
        <Trash2 size={15} /> Удалить
      </button>
    </div>
  );
}
