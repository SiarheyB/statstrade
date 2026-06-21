"use client";

import { useEffect, useState } from "react";
import { KeyRound, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

export default function ChangePassword() {
  const { t } = useI18n();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/auth/password");
      if (res.ok) setHasPassword((await res.json()).hasPassword);
      else setHasPassword(true);
    })();
  }, []);

  function reset() {
    setOpen(false);
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  }

  async function save() {
    setError(null);
    if (next.length < 8) {
      setError(t("settings.password.tooShort"));
      return;
    }
    if (next !== confirm) {
      setError(t("settings.password.mismatch"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          hasPassword ? { currentPassword: current, newPassword: next } : { newPassword: next },
        ),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? t("settings.saveError"));
        return;
      }
      setHasPassword(true);
      reset();
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  const title = hasPassword === false ? t("settings.password.set") : t("settings.password");

  return (
    <div className="card p-5 mb-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-medium text-sm flex items-center gap-2">
            <KeyRound size={16} className="text-faint" />
            {title}
          </h3>
          <p className="text-xs text-faint mt-0.5">
            {hasPassword === false ? t("settings.password.setHint") : t("settings.passwordHint")}
          </p>
        </div>
        {!open && (
          <button
            onClick={() => { setOpen(true); setDone(false); }}
            className="px-3 py-2 rounded-lg input-base text-sm hover:border-border-strong shrink-0"
          >
            {title}
          </button>
        )}
        {done && (
          <span className="inline-flex items-center gap-1.5 text-xs text-profit shrink-0">
            <Check size={14} /> {t("settings.password.changed")}
          </span>
        )}
      </div>

      {open && (
        <div className="mt-5 border-t border-border pt-5 space-y-3 max-w-sm">
          {hasPassword && (
            <div>
              <label className="block text-xs text-muted mb-1">{t("settings.password.current")}</label>
              <input
                type="password"
                autoComplete="current-password"
                maxLength={200}
                className="input-base w-full"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
          )}
          <div>
            <label className="block text-xs text-muted mb-1">{t("settings.password.new")}</label>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={200}
              className="input-base w-full"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder={t("auth.passwordHintReg")}
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">{t("settings.password.confirm")}</label>
            <input
              type="password"
              autoComplete="new-password"
              maxLength={200}
              className="input-base w-full"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          {error && (
            <div className="text-sm text-loss bg-loss/10 border border-loss/30 rounded-lg px-3 py-2">{error}</div>
          )}

          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition disabled:opacity-50"
            >
              {busy ? t("common.saving") : t("common.save")}
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
