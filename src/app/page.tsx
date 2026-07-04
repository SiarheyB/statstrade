import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SUPPORTED_EXCHANGES } from "@/lib/exchanges";
import { getEnabledExchangeMetas } from "@/lib/exchangeToggle";
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
  ShieldAlert,
  Flame,
  Layers,
} from "lucide-react";

// Год запуска проекта — левая граница в «© 2026–20XX» футера. Когда текущий год
// совпадает с годом запуска, диапазон схлопывается до одного года.
const START_YEAR = 2026;

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const { t } = await getServerT();

  // Список бирж — из единого источника (SUPPORTED_EXCHANGES) с учётом
  // админ-тумблеров: новые/выключенные биржи попадают на лендинг сами, без
  // правки текстов. Если БД недоступна — фолбэк на полный статичный список.
  const exchangeNames = await getEnabledExchangeMetas()
    .then((metas) => metas.map((m) => m.name))
    .catch(() => Object.values(SUPPORTED_EXCHANGES).map((m) => m.name));
  const badgeTop = exchangeNames.slice(0, 3).join(" · ");
  const badgeRest = exchangeNames.length - 3;
  const badge =
    badgeRest > 0 ? t("landing.badge", { top: badgeTop, n: badgeRest }) : badgeTop;

  const features = [
    {
      icon: Plug,
      title: t("landing.f1.title"),
      text: t("landing.f1.text", { list: exchangeNames.join(", ") }),
    },
    { icon: BarChart3, title: t("landing.f2.title", { count: TOTAL_METRICS }), text: t("landing.f2.text") },
    { icon: LineChart, title: t("landing.f3.title"), text: t("landing.f3.text") },
    { icon: TrendingUp, title: t("landing.f4.title"), text: t("landing.f4.text") },
    { icon: ShieldCheck, title: t("landing.f5.title"), text: t("landing.f5.text") },
    { icon: Wallet, title: t("landing.f6.title"), text: t("landing.f6.text") },
    { icon: ShieldAlert, title: t("landing.f7.title"), text: t("landing.f7.text") },
    { icon: Flame, title: t("landing.f8.title"), text: t("landing.f8.text") },
    { icon: Layers, title: t("landing.f9.title"), text: t("landing.f9.text") },
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
            {badge}
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
        © {START_YEAR === new Date().getFullYear() ? START_YEAR : `${START_YEAR}–${new Date().getFullYear()}`}{" "}
        TradeStats · {t("common.footerTagline")}
      </footer>
    </div>
  );
}
