"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import TurnstileWidget from "@/components/TurnstileWidget";
import { useI18n } from "@/lib/i18n/provider";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const [code, setCode] = useState("");
  // Honeypot (заполняют только боты) и токен капчи.
  const [website, setWebsite] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");

  const isRegister = mode === "register";
  const turnstileOn = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isRegister
            ? { email, password, name, website, turnstileToken }
            : { email, password },
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error");
        return;
      }
      // 2FA: switch to the code-entry step instead of navigating.
      if (data.twoFactorRequired) {
        setTwoFactor(true);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(t("auth.networkError"));
    } finally {
      setLoading(false);
    }
  }

  async function onGoogle(credential: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error");
        return;
      }
      if (data.twoFactorRequired) {
        setTwoFactor(true);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(t("auth.networkError"));
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(t("auth.networkError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="flex items-center justify-center gap-2 font-semibold text-lg mb-8"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <BarChart3 size={18} />
          </span>
          TradeStats
        </Link>

        <div className="card p-6">
          <h1 className="text-xl font-semibold mb-1">
            {twoFactor
              ? t("auth.twoFactor.title")
              : isRegister
                ? t("auth.register.title")
                : t("auth.login.title")}
          </h1>
          <p className="text-sm text-muted mb-5">
            {twoFactor
              ? t("auth.twoFactor.subtitle")
              : isRegister
                ? t("auth.register.subtitle")
                : t("auth.login.subtitle")}
          </p>

          {twoFactor ? (
            <form onSubmit={onSubmitCode} className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">{t("auth.twoFactor.code")}</label>
                <input
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  className="input-base w-full text-center text-lg tracking-[0.4em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                />
              </div>
              {error && (
                <div className="text-sm text-loss bg-loss/10 border border-loss/30 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading || code.length < 6}
                className="w-full py-2.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition disabled:opacity-50"
              >
                {loading ? t("auth.wait") : t("auth.twoFactor.verify")}
              </button>
              <button
                type="button"
                onClick={() => { setTwoFactor(false); setCode(""); setError(null); }}
                className="w-full py-2 text-sm text-muted hover:text-fg transition"
              >
                {t("common.back")}
              </button>
            </form>
          ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            {/* Honeypot: скрыт от людей, видят только боты. Заполнен → отказ. */}
            {isRegister && (
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
              />
            )}
            {isRegister && (
              <div>
                <label className="block text-xs text-muted mb-1">{t("auth.name")}</label>
                <input
                  className="input-base w-full"
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("auth.namePlaceholder")}
                />
              </div>
            )}
            <div>
              <label className="block text-xs text-muted mb-1">{t("auth.email")}</label>
              <input
                type="email"
                required
                maxLength={254}
                className="input-base w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">{t("auth.password")}</label>
              <input
                type="password"
                required
                minLength={isRegister ? 8 : undefined}
                maxLength={200}
                className="input-base w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isRegister ? t("auth.passwordHintReg") : "••••••••"}
              />
            </div>

            {isRegister && <TurnstileWidget onToken={setTurnstileToken} />}

            {error && (
              <div className="text-sm text-loss bg-loss/10 border border-loss/30 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (isRegister && turnstileOn && !turnstileToken)}
              className="w-full py-2.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition disabled:opacity-50"
            >
              {loading
                ? t("auth.wait")
                : isRegister
                  ? t("auth.signUp")
                  : t("auth.signIn")}
            </button>
          </form>
          )}

          {!twoFactor && (
            <div className="mt-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-faint">{t("auth.or")}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <GoogleSignInButton onCredential={onGoogle} />
            </div>
          )}
        </div>

        <p className="text-center text-sm text-muted mt-4">
          {isRegister ? (
            <>
              {t("auth.haveAccount")}{" "}
              <Link href="/login" className="text-accent hover:underline">
                {t("auth.toLogin")}
              </Link>
            </>
          ) : (
            <>
              {t("auth.noAccount")}{" "}
              <Link href="/register" className="text-accent hover:underline">
                {t("auth.toRegister")}
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
