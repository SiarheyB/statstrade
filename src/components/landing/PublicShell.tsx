import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { getServerT } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth";
import LocaleMenu from "@/components/LocaleMenu";

/**
 * Обёртка публичных страниц (/news, /calendar): та же шапка и футер, что на
 * лендинге. Данные внутри — те же клиентские компоненты, что в дашборде:
 * дублировать ленту новостей и календарь ради гостя незачем, API у них теперь
 * открытый (см. /api/news, /api/econcal).
 */
export default async function PublicShell({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  const { t } = await getServerT();
  const session = await getSession();

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 px-4 sm:px-6 py-4 border-b border-border glass-panel">
        <Link href="/" className="flex items-center gap-2 font-semibold text-base sm:text-lg">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <BarChart3 size={18} />
          </span>
          TradeStats
        </Link>
        <nav className="flex flex-nowrap items-center gap-2 sm:gap-3 text-sm whitespace-nowrap">
          <Link href="/" className="hidden sm:block px-2 py-1.5 text-muted hover:text-fg transition">
            {t("landing.nav.home")}
          </Link>
          <Link href="/news" className="hidden sm:block px-2 py-1.5 text-muted hover:text-fg transition">
            {t("landing.nav.news")}
          </Link>
          <Link href="/calendar" className="hidden sm:block px-2 py-1.5 text-muted hover:text-fg transition">
            {t("landing.nav.calendar")}
          </Link>
          <Link href="/pricing" className="hidden sm:block px-2 py-1.5 text-muted hover:text-fg transition">
            {t("pricing.nav")}
          </Link>
          <LocaleMenu />
          {session ? (
            <Link href="/dashboard" className="px-3 sm:px-4 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition">
              {t("nav.overview")}
            </Link>
          ) : (
            <>
              <Link href="/login" className="hidden sm:block px-3 py-1.5 text-muted hover:text-fg transition">
                {t("landing.signIn")}
              </Link>
              <Link href="/register" className="px-3 sm:px-4 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition">
                {t("landing.start")}
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-6">
        <h1 className="sr-only">{title}</h1>
        {children}
      </main>

      <footer className="border-t border-border px-6 py-5 text-center text-xs text-faint">
        TradeStats · {t("common.footerTagline")}
      </footer>
    </div>
  );
}
