import type { LandingStats as Stats } from "@/lib/landing";

/**
 * Полоса живых чисел под hero. Значения настоящие (см. lib/landing.ts) — это
 * состояние сервиса прямо сейчас, а не витрина: пустой день так и покажет ноль
 * сетапов.
 */
export default function LandingStats({
  stats,
  locale,
  t,
}: {
  stats: Stats;
  locale: string;
  t: (key: string) => string;
}) {
  const nf = new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US");
  const cells: { value: number; label: string }[] = [
    { value: stats.setups, label: t("landing.stats.setups") },
    { value: stats.symbols, label: t("landing.stats.symbols") },
    { value: stats.events, label: t("landing.stats.events") },
    { value: stats.news, label: t("landing.stats.news") },
  ];

  return (
    <div className="border-y border-border bg-surface">
      <div className="max-w-6xl mx-auto grid grid-cols-2 sm:grid-cols-4">
        {cells.map((c, i) => (
          <div
            key={c.label}
            className={[
              "px-4 py-3 text-center border-border",
              i < cells.length - 1 ? "sm:border-r" : "",
              i % 2 === 0 ? "border-r sm:border-r" : "",
              i < 2 ? "border-b sm:border-b-0" : "",
            ].join(" ")}
          >
            <div className="text-lg font-semibold tabular-nums tracking-tight">{nf.format(c.value)}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-faint">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
