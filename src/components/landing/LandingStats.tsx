import type { LandingStats as Stats } from "@/lib/landing";

/**
 * Строка состояния сервиса под hero. Значения настоящие (см. lib/landing.ts) —
 * это то, что происходит прямо сейчас, а не витрина: пустой день так и покажет
 * ноль сетапов.
 *
 * Сознательно НЕ карточки и не сетка с рамками: четыре крупных числа в
 * коробках спорят с hero за внимание и разрывают страницу на две несвязанные
 * половины. Здесь это одна тихая строка — подпись под заголовком, а акцент
 * остаётся на кнопках и на карточке сигнала ниже.
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
    <div className="max-w-6xl mx-auto px-6">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px] text-faint">
        <span className="mr-1 inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-profit" aria-hidden="true" />
        </span>
        {cells.map((c, i) => (
          <span key={c.label} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="mr-1 text-border-strong">·</span>}
            <span className="font-semibold tabular-nums text-fg">{nf.format(c.value)}</span>
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}
