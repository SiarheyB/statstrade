import Link from "next/link";
import { Check, Sparkles, ArrowRight } from "lucide-react";
import type { T } from "@/lib/i18n/provider";

// Что показываем в карточке: четыре группы возможностей одной строкой каждая —
// подробный список живёт на /pricing, пересказывать его здесь незачем.
const CARD_ITEMS = ["exchanges", "metrics", "setups", "mentor", "risk"];

/**
 * Блок про цену на главной.
 *
 * Стоит последним, после «Как это работает»: человек только что прочитал, что
 * сервис умеет, и первый же вопрос — сколько это стоит. Отвечаем сразу и
 * уводим на /pricing за подробностями.
 */
export default function LandingPricing({ t, exchangeCount }: { t: T; exchangeCount: number }) {
  return (
    <section className="max-w-6xl mx-auto px-6 pt-10 pb-16">
      <h2 className="text-center text-[22px] font-semibold tracking-tight">
        {t("landing.pricing.title")}
      </h2>

      <div className="card relative mx-auto mt-6 max-w-md overflow-hidden p-6 text-center">
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

          <ul className="mt-5 space-y-2 text-left">
            {CARD_ITEMS.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm">
                <Check size={14} className="mt-0.5 shrink-0 text-profit" />
                <span>
                  {item === "exchanges"
                    ? t("landing.pricing.item.exchanges", { n: exchangeCount })
                    : t(`landing.pricing.item.${item}`)}
                </span>
              </li>
            ))}
          </ul>

          <Link
            href="/register"
            className="mt-5 block rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent/90"
          >
            {t("landing.ctaCreate")}
          </Link>
          <Link
            href="/pricing"
            className="mt-2 inline-flex items-center justify-center gap-1.5 text-xs text-accent hover:underline"
          >
            {t("landing.pricing.more")} <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    </section>
  );
}
