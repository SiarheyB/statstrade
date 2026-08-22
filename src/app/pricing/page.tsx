import type { Metadata } from "next";
import Link from "next/link";
import { Check, Sparkles, Shield, LineChart, Radar, Link2 } from "lucide-react";
import PublicShell from "@/components/landing/PublicShell";
import { getServerT, getLocale } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/provider";
import { pageMetadata, SEO_PAGES } from "@/lib/seo";
import { PRICING_FAQ, PRICING_GROUPS } from "@/lib/pricing";
import { TOTAL_METRICS } from "@/lib/analytics/metric-defs";
import { getEnabledExchangeMetas } from "@/lib/exchangeToggle";
import { SUPPORTED_EXCHANGES } from "@/lib/exchangeIds";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata(SEO_PAGES.pricing, await getLocale());
}

// Своя иконка на группу: четыре одинаковых списка галочек сливаются, а так
// глаз цепляется за нужный раздел.
const GROUP_ICON: Record<string, React.ReactNode> = {
  connect: <Link2 size={16} />,
  analytics: <LineChart size={16} />,
  market: <Radar size={16} />,
  discipline: <Shield size={16} />,
};

/**
 * Публичная страница тарифов.
 *
 * Тариф один и бесплатный, поэтому это не таблица сравнения планов (сравнивать
 * не с чем), а один сплошной список: что входит и где границы. Возможности
 * идут по отдельности — так виден объём работы, и человек находит глазами
 * конкретное. Лимиты стоят значением в своей же строке, а не отдельным блоком
 * внизу: число нужно там, где о нём думаешь.
 */
export default async function PricingPage() {
  const { t } = await getServerT();
  // Сколько бирж поддержано — из общего источника с админ-тумблерами, как на
  // лендинге: включили новую — число выросло само. Если БД недоступна, берём
  // полный статичный список.
  const exchangeCount = await getEnabledExchangeMetas()
    .then((metas) => metas.length)
    .catch(() => Object.keys(SUPPORTED_EXCHANGES).length);

  return (
    <PublicShell title={t("pricing.title")}>
      <div className="mx-auto max-w-5xl">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("pricing.title")}</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted">{t("pricing.subtitle")}</p>
        </header>

        <PlanCard t={t} />

        <section className="card mt-12 overflow-hidden p-0">
          <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-3">
            <h2 className="text-sm font-medium">{t("pricing.included")}</h2>
            <span className="text-xs text-faint">{t("pricing.planName")}</span>
          </div>

          {PRICING_GROUPS.map((g) => (
            <div key={g.key}>
              <div className="flex items-center gap-2 border-b border-border bg-surface-2/40 px-5 py-2">
                <span className="text-accent">{GROUP_ICON[g.key]}</span>
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
                  {t(`pricing.group.${g.key}.title`)}
                </h3>
              </div>
              <ul>
                {g.items.map((item) => (
                  <li
                    key={item.key}
                    className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-2.5 text-sm last:border-0"
                  >
                    <span className="leading-snug">{itemText(t, item.key, exchangeCount)}</span>
                    {item.value ? (
                      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-accent">
                        {t(`pricing.value.${item.value}`)}
                      </span>
                    ) : (
                      <Check size={15} className="mt-0.5 shrink-0 text-profit" />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <p className="mt-3 text-center text-xs text-faint">{t("pricing.limitsNote")}</p>

        <Faq t={t} />
        <FooterCta t={t} />
      </div>
    </PublicShell>
  );
}

// Карточка тарифа ровно одна — поэтому по центру, а не в ряду: выбирать не из
// чего, и «сравнительная» вёрстка только сбивала бы с толку.
function PlanCard({ t }: { t: T }) {
  return (
    <div className="card relative mx-auto mt-8 max-w-md overflow-hidden p-6 text-center">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-accent/10 to-transparent" />
      <div className="relative">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-accent">
          <Sparkles size={12} /> {t("pricing.planName")}
        </span>
        {/* Символ доллара слева от числа: «$0», а не «0 $». */}
        <div className="mt-4 flex items-baseline justify-center gap-0.5">
          <span className="text-2xl text-muted">{t("pricing.currency")}</span>
          <span className="text-5xl font-semibold tabular-nums">{t("pricing.planPrice")}</span>
        </div>
        <p className="mt-1 text-sm text-muted">{t("pricing.planPer")}</p>

        <div className="mt-5 flex flex-col gap-2">
          <Link
            href="/register"
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent/90"
          >
            {t("pricing.ctaCreate")}
          </Link>
          <Link
            href="/?demo=1"
            className="rounded-lg border border-border px-4 py-2.5 text-sm text-muted transition hover:border-border-strong hover:text-fg"
          >
            {t("pricing.ctaDemo")}
          </Link>
        </div>
        <p className="mt-3 text-[11px] text-faint">{t("pricing.planNote")}</p>
      </div>
    </div>
  );
}

// Подстановки в строки списка: число метрик и списки бирж. Всё берётся из
// кода, а не вписано руками, — иначе после добавления биржи страница врала бы.
function itemText(t: T, item: string, exchangeCount: number): string {
  if (item === "metrics") return t("pricing.item.metrics", { n: TOTAL_METRICS });
  if (item === "exchanges") return t("pricing.item.exchanges", { n: exchangeCount });
  return t(`pricing.item.${item}`);
}

function Faq({ t }: { t: T }) {
  return (
    <section className="mt-12">
      <h2 className="text-center text-sm font-medium text-muted">{t("pricing.faq")}</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {PRICING_FAQ.map((key) => (
          <div key={key} className="card p-5">
            <h3 className="text-sm font-medium">{t(`pricing.faq.${key}.q`)}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{t(`pricing.faq.${key}.a`)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FooterCta({ t }: { t: T }) {
  return (
    <div className="card mt-12 p-6 text-center">
      <p className="text-sm text-muted">{t("pricing.footerCta")}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link
          href="/register"
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent/90"
        >
          {t("pricing.ctaCreate")}
        </Link>
        <Link
          href="/?demo=1"
          className="rounded-lg border border-border px-4 py-2.5 text-sm text-muted transition hover:border-border-strong hover:text-fg"
        >
          {t("pricing.ctaDemo")}
        </Link>
      </div>
    </div>
  );
}
