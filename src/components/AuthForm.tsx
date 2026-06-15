"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isRegister = mode === "register";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isRegister ? { email, password, name } : { email, password },
        ),
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
            {isRegister ? t("auth.register.title") : t("auth.login.title")}
          </h1>
          <p className="text-sm text-muted mb-5">
            {isRegister ? t("auth.register.subtitle") : t("auth.login.subtitle")}
          </p>

          <form onSubmit={onSubmit} className="space-y-3">
            {isRegister && (
              <div>
                <label className="block text-xs text-muted mb-1">{t("auth.name")}</label>
                <input
                  className="input-base w-full"
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
                className="input-base w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isRegister ? t("auth.passwordHintReg") : "••••••••"}
              />
            </div>

            {error && (
              <div className="text-sm text-loss bg-loss/10 border border-loss/30 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition disabled:opacity-50"
            >
              {loading
                ? t("auth.wait")
                : isRegister
                  ? t("auth.signUp")
                  : t("auth.signIn")}
            </button>
          </form>
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
