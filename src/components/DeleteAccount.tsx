"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

export default function DeleteAccount() {
  const { t } = useI18n();
  const router = useRouter();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/auth/password");
      if (res.ok) setHasPassword((await res.json()).hasPassword);
      else setHasPassword(true);
    })();
  }, []);

  function reset() {
    setOpen(false);
    setPassword("");
    setError(null);
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hasPassword ? { password } : {}),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? t("settings.deleteAccount.error"));
        return;
      }
      router.push("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 mb-5 border-loss/30">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-medium text-sm flex items-center gap-2 text-loss">
            <Trash2 size={16} />
            {t("settings.deleteAccount")}
          </h3>
          <p className="text-xs text-faint mt-0.5 max-w-md">{t("settings.deleteAccount.hint")}</p>
        </div>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="px-3 py-2 rounded-lg input-base text-sm text-loss hover:border-loss/50 shrink-0"
          >
            {t("settings.deleteAccount")}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-5 border-t border-border pt-5 space-y-3 max-w-sm">
          <div className="text-sm text-loss bg-loss/10 border border-loss/30 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            {t("settings.deleteAccount.warning")}
          </div>

          {hasPassword && (
            <div>
              <label className="block text-xs text-muted mb-1">{t("settings.deleteAccount.password")}</label>
              <input
                type="password"
                autoComplete="current-password"
                maxLength={200}
                className="input-base w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          {error && (
            <div className="text-sm text-loss bg-loss/10 border border-loss/30 rounded-lg px-3 py-2">{error}</div>
          )}

          <div className="flex gap-2">
            <button
              onClick={remove}
              disabled={busy || (!!hasPassword && !password)}
              className="px-4 py-2 rounded-lg bg-loss text-white text-sm font-medium hover:bg-loss/90 transition disabled:opacity-50"
            >
              {busy ? t("common.saving") : t("settings.deleteAccount.confirm")}
            </button>
            <button onClick={reset} className="px-4 py-2 rounded-lg input-base text-sm hover:border-border-strong">
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
