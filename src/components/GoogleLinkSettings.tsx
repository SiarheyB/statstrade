"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import { useI18n } from "@/lib/i18n/provider";

export default function GoogleLinkSettings() {
  const { t } = useI18n();
  const [linked, setLinked] = useState<boolean | null>(null);
  const [hasPassword, setHasPassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The button only works when Google is configured; otherwise hide the card.
  const configured = !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/auth/google/link");
      if (res.ok) {
        const d = await res.json();
        setLinked(d.linked);
        setHasPassword(d.hasPassword);
      } else {
        setLinked(false);
      }
    })();
  }, []);

  async function link(credential: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/google/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? t("settings.saveError"));
        return;
      }
      setLinked(true);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/google/link", { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? t("settings.saveError"));
        return;
      }
      setLinked(false);
    } finally {
      setBusy(false);
    }
  }

  if (!configured) return null;

  return (
    <div className="card p-5 mb-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-medium text-sm">{t("settings.google")}</h3>
          <p className="text-xs text-faint mt-0.5">
            {linked ? t("settings.google.linkedHint") : t("settings.googleHint")}
          </p>
        </div>
        {linked && (
          <span className="inline-flex items-center gap-1.5 text-xs text-profit bg-profit/10 border border-profit/30 rounded-lg px-2.5 py-1 shrink-0">
            <Check size={13} /> {t("settings.google.linked")}
          </span>
        )}
      </div>

      {linked === false && (
        <div className="mt-4">
          <GoogleSignInButton onCredential={link} />
        </div>
      )}

      {linked && hasPassword && (
        <button
          onClick={unlink}
          disabled={busy}
          className="mt-4 px-3 py-2 rounded-lg input-base text-sm hover:border-border-strong disabled:opacity-50"
        >
          {t("settings.google.unlink")}
        </button>
      )}

      {linked && !hasPassword && (
        <p className="mt-3 text-xs text-faint">{t("settings.google.needPassword")}</p>
      )}

      {error && (
        <div className="mt-3 text-sm text-loss bg-loss/10 border border-loss/30 rounded-lg px-3 py-2">{error}</div>
      )}
    </div>
  );
}
