"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ShieldCheck, ShieldOff, Check, Copy } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

type Setup = { secret: string; otpauth: string; qr: string };

export default function TwoFactorSettings() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"idle" | "setup" | "disable">("idle");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/auth/2fa");
      if (res.ok) setEnabled((await res.json()).enabled);
      else setEnabled(false);
    })();
  }, []);

  function reset() {
    setMode("idle");
    setSetup(null);
    setCode("");
    setError(null);
  }

  async function startSetup() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/2fa/setup", { method: "POST" });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? t("settings.saveError"));
        return;
      }
      setSetup(d);
      setMode("setup");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/2fa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? t("settings.saveError"));
        return;
      }
      setEnabled(true);
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/2fa", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? t("settings.saveError"));
        return;
      }
      setEnabled(false);
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!setup) return;
    await navigator.clipboard.writeText(setup.secret).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-medium text-sm flex items-center gap-2">
            {enabled ? (
              <ShieldCheck size={16} className="text-profit" />
            ) : (
              <ShieldOff size={16} className="text-faint" />
            )}
            {t("settings.twoFactor")}
          </h3>
          <p className="text-xs text-faint mt-0.5">{t("settings.twoFactorHint")}</p>
        </div>
        {enabled !== null && mode === "idle" && (
          <>
            {enabled ? (
              <button
                onClick={() => { setMode("disable"); setError(null); }}
                className="px-3 py-2 rounded-lg input-base text-sm hover:border-border-strong"
              >
                {t("settings.twoFactor.disable")}
              </button>
            ) : (
              <button
                onClick={startSetup}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition disabled:opacity-50"
              >
                {busy ? t("common.loading") : t("settings.twoFactor.enable")}
              </button>
            )}
          </>
        )}
      </div>

      {enabled && mode === "idle" && (
        <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-profit bg-profit/10 border border-profit/30 rounded-lg px-2.5 py-1">
          <Check size={13} /> {t("settings.twoFactor.on")}
        </div>
      )}

      {/* Enable flow */}
      {mode === "setup" && setup && (
        <div className="mt-5 border-t border-border pt-5 space-y-4">
          <ol className="text-sm text-muted space-y-1 list-decimal list-inside">
            <li>{t("settings.twoFactor.step1")}</li>
            <li>{t("settings.twoFactor.step2")}</li>
            <li>{t("settings.twoFactor.step3")}</li>
          </ol>

          <div className="flex flex-col sm:flex-row gap-5 items-start">
            <div className="rounded-lg bg-white p-2 shrink-0">
              <Image src={setup.qr} alt="QR" width={180} height={180} unoptimized />
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="text-xs text-faint">{t("settings.twoFactor.manualKey")}</div>
              <button
                onClick={copySecret}
                className="inline-flex items-center gap-2 font-mono text-sm break-all rounded-lg input-base px-3 py-2 hover:border-border-strong"
              >
                {copied ? <Check size={13} className="text-profit" /> : <Copy size={13} />}
                {setup.secret}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">{t("settings.twoFactor.codeLabel")}</label>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="input-base w-40 tracking-[0.3em] text-center text-lg"
            />
          </div>

          {error && (
            <div className="text-sm text-loss bg-loss/10 border border-loss/30 rounded-lg px-3 py-2">{error}</div>
          )}

          <div className="flex gap-2">
            <button
              onClick={confirm}
              disabled={busy || code.length < 6}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition disabled:opacity-50"
            >
              {busy ? t("common.saving") : t("settings.twoFactor.confirm")}
            </button>
            <button onClick={reset} className="px-4 py-2 rounded-lg input-base text-sm hover:border-border-strong">
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Disable flow */}
      {mode === "disable" && (
        <div className="mt-5 border-t border-border pt-5 space-y-3">
          <p className="text-sm text-muted">{t("settings.twoFactor.disableHint")}</p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="input-base w-40 tracking-[0.3em] text-center text-lg"
          />
          {error && (
            <div className="text-sm text-loss bg-loss/10 border border-loss/30 rounded-lg px-3 py-2">{error}</div>
          )}
          <div className="flex gap-2">
            <button
              onClick={disable}
              disabled={busy || code.length < 6}
              className="px-4 py-2 rounded-lg bg-loss text-white text-sm font-medium hover:bg-loss/90 transition disabled:opacity-50"
            >
              {busy ? t("common.saving") : t("settings.twoFactor.disable")}
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
