import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { TOTAL_METRICS } from "@/lib/analytics/metric-defs";
import { getServerT } from "@/lib/i18n/server";
import ThemeMenu from "@/components/ThemeMenu";
import LocaleMenu from "@/components/LocaleMenu";
import {
  BarChart3,
  ShieldCheck,
  Plug,
  TrendingUp,
  LineChart,
  Wallet,
} from "lucide-react";

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const { t } = await getServerT();

  const features = [
    { icon: Plug, title: t("landing.f1.title"), text: t("landing.f1.text") },
    { icon: BarChart3, title: t("landing.f2.title", { count: TOTAL_METRICS }), text: t("landing.f2.text") },
    { icon: LineChart, title: t("landing.f3.title"), text: t("landing.f3.text") },
    { icon: TrendingUp, title: t("landing.f4.title"), text: t("landing.f4.text") },
    { icon: ShieldCheck, title: t("landing.f5.title"), text: t("landing.f5.text") },
    { icon: Wallet, title: t("landing.f6.title"), text: t("landing.f6.text") },
  ];

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-30 flex items-center justify-between px-6 py-4 border-b border-border glass-panel">
        <div className="flex items-center gap-2 font-semibold text-lg">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <BarChart3 size={18} />
          </span>
          TradeStats
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <LocaleMenu />
          <ThemeMenu />
          <Link href="/login" className="px-3 py-1.5 text-muted hover:text-fg transition">
            {t("landing.signIn")}
          </Link>
          <Link
            href="/register"
            className="px-4 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition"
          >
            {t("landing.start")}
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-profit" />
            {t("landing.badge")}
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            {t("landing.heroPre")}{" "}
            <span className="text-accent">{t("landing.heroAccent")}</span>
          </h1>
          <p className="mt-5 text-lg text-muted max-w-2xl mx-auto">
            {t("landing.heroDesc")}
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/register"
              className="px-6 py-3 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition"
            >
              {t("landing.ctaCreate")}
            </Link>
            <Link
              href="/login"
              className="px-6 py-3 rounded-lg border border-border bg-surface hover:border-border-strong transition"
            >
              {t("landing.ctaHave")}
            </Link>
          </div>
          <p className="mt-4 text-xs text-faint">{t("landing.demoHint")}</p>
        </section>

        <section className="max-w-6xl mx-auto px-6 pb-24 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="card p-5">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent mb-3">
                <f.icon size={20} />
              </div>
              <h3 className="font-medium mb-1">{f.title}</h3>
              <p className="text-sm text-muted leading-relaxed">{f.text}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border px-6 py-5 text-center text-xs text-faint">
        {t("common.demoFooter")}
      </footer>
    </div>
  );
}
