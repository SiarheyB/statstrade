import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SUPPORTED_EXCHANGES } from "@/lib/exchanges";
import { getEnabledExchangeMetas } from "@/lib/exchangeToggle";
import { TOTAL_METRICS } from "@/lib/analytics/metric-defs";
import { getServerT, getLocale, getTimezone } from "@/lib/i18n/server";
import { getLandingData } from "@/lib/landing";
import LocaleMenu from "@/components/LocaleMenu";
import LandingCalendar from "@/components/landing/LandingCalendar";
import LandingSignal from "@/components/landing/LandingSignal";
import LandingNews from "@/components/landing/LandingNews";
import LandingFeatures from "@/components/landing/LandingFeatures";
import { BarChart3 } from "lucide-react";

// Год запуска проекта — левая граница в «© 2026–20XX» футера. Когда текущий год
// совпадает с годом запуска, диапазон схлопывается до одного года.
const START_YEAR = 2026;

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const { t } = await getServerT();
  const [locale, timezone] = await Promise.all([getLocale(), getTimezone()]);

  // Рыночный блок не должен ронять лендинг: если БД или фиды недоступны,
  // страница просто рисуется без него.
  const landing = await getLandingData(locale).catch(() => null);

  // Список бирж — из единого источника (SUPPORTED_EXCHANGES) с учётом
  // админ-тумблеров: новые/выключенные биржи попадают на лендинг сами, без
  // правки текстов. Если БД недоступна — фолбэк на полный статичный список.
  const exchangeNames = await getEnabledExchangeMetas()
    .then((metas) => metas.map((m) => m.name))
    .catch(() => Object.values(SUPPORTED_EXCHANGES).map((m) => m.name));


  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 px-4 sm:px-6 py-4 border-b border-border glass-panel">
        <div className="flex items-center gap-2 font-semibold text-base sm:text-lg">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <BarChart3 size={18} />
          </span>
          TradeStats
        </div>
        {/* nowrap: на 375px шапка иначе переполняется и «Начать» уезжает за
            край экрана. Всё, что не помещается, прячется до sm — вход есть на
            самой странице регистрации, а демо — кнопкой в hero. */}
        <nav className="flex flex-nowrap items-center gap-2 sm:gap-3 text-sm whitespace-nowrap">
          <Link href="/news" className="hidden sm:block px-2 py-1.5 text-muted hover:text-fg transition">
            {t("landing.nav.news")}
          </Link>
          <Link href="/calendar" className="hidden sm:block px-2 py-1.5 text-muted hover:text-fg transition">
            {t("landing.nav.calendar")}
          </Link>
          <LocaleMenu />
          <form action="/api/demo" method="post" className="hidden sm:block">
            <button
              type="submit"
              className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-accent transition hover:bg-accent/15"
            >
              {t("landing.nav.demo")}
            </button>
          </form>
          <Link href="/login" className="hidden sm:block px-3 py-1.5 text-muted hover:text-fg transition">
            {t("landing.signIn")}
          </Link>
          <Link
            href="/register"
            className="px-3 sm:px-4 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition"
          >
            {t("landing.start")}
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="max-w-4xl mx-auto px-6 pt-16 pb-12 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            {t("landing.heroPre")}{" "}
            <span className="text-accent">{t("landing.heroAccent")}</span>
          </h1>
          <p className="mt-5 text-lg text-muted max-w-2xl mx-auto">
            {t("landing.heroDesc")}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <Link
              href="/register"
              className="px-6 py-3 rounded-lg bg-accent text-white font-medium text-center whitespace-nowrap hover:bg-accent/90 transition"
            >
              {t("landing.ctaCreate")}
            </Link>
            <Link
              href="/login"
              className="px-6 py-3 rounded-lg border border-border bg-surface text-center whitespace-nowrap hover:border-border-strong transition"
            >
              {t("landing.ctaHave")}
            </Link>
            {/* Демо — POST-форма, а не ссылка: заход выдаёт cookie, и префетч
                браузера не должен его запускать. Работает без JS. */}
            {/* contents — чтобы кнопка была прямым элементом flex-строки CTA и
                тянулась вровень с соседями, а не жила в своей коробке. */}
            <form action="/api/demo" method="post" className="contents">
              <button
                type="submit"
                className="px-6 py-3 rounded-lg border border-accent/40 bg-accent/10 text-accent text-center whitespace-nowrap hover:bg-accent/15 transition"
              >
                {t("landing.demoCta")}
              </button>
            </form>
          </div>
          <p className="mt-4 text-xs text-faint">{t("landing.demoHint")}</p>
        </section>

        {landing && (
          <>
            <section className="max-w-6xl mx-auto px-6 pt-4">
              <LandingNews items={landing.news} locale={locale} timezone={timezone} t={t} />
            </section>
            <section className="max-w-6xl mx-auto px-6 pt-6 pb-2 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
              <LandingCalendar
                events={landing.events}
                locale={locale}
                timezone={timezone}
                now={landing.generatedAt}
                t={t}
              />
              <LandingSignal
                signal={landing.signal}
                locale={locale}
                timezone={timezone}
                t={t}
              />
            </section>
          </>
        )}

        <LandingFeatures
          metricsCount={TOTAL_METRICS}
          symbolsScanned={landing?.stats.symbols ?? 0}
          setupsFound={landing?.stats.setups ?? 0}
          exchanges={exchangeNames}
          t={t}
        />

      </main>

      <footer className="border-t border-border px-6 py-5 text-center text-xs text-faint">
        © {START_YEAR === new Date().getFullYear() ? START_YEAR : `${START_YEAR}–${new Date().getFullYear()}`}{" "}
        TradeStats · {t("common.footerTagline")}
      </footer>
    </div>
  );
}
