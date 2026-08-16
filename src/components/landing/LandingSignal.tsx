import type { LandingSignal as Signal } from "@/lib/landing";
import type { Locale } from "@/lib/i18n/core";
import type { TimezoneId } from "@/lib/timezone";
import { ianaFor } from "@/lib/timezone";
import SignalSparkline from "./SignalSparkline";

/**
 * «Сигнал дня» — сильнейший сетап последнего отбора. Гостю показываем ФАКТ
 * сигнала: инструмент, сторону, цену, уровень и чистоту. Разбор «за/против» и
 * история сетапа остаются в личном кабинете — иначе рекомендация раздаётся
 * целиком и заходить в сервис незачем.
 *
 * Единственное цветное пятно лендинга: рамка, подложка и бейдж в цвет стороны
 * сделки, а дневной график уходит в фон полупрозрачной подложкой.
 */
export default function LandingSignal({
  signal,
  locale,
  timezone,
  t,
}: {
  signal: Signal | null;
  locale: Locale;
  timezone: TimezoneId;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  if (!signal) {
    return (
      <div className="card flex flex-col justify-center gap-2 p-5">
        <span className="text-sm font-medium">{t("landing.signal.title")}</span>
        <p className="text-sm text-muted">{t("landing.signal.empty")}</p>
      </div>
    );
  }

  const isShort = signal.direction === "short";
  // Классы Tailwind обязаны быть литералами: динамический `text-${tone}` не
  // попадает в сборку и молча теряет цвет.
  const toneText = isShort ? "text-loss" : "text-profit";
  const toneVar = isShort ? "var(--color-loss)" : "var(--color-profit)";
  // labels.ts — только по-русски (машинные ключи БД → русский UI дашборда), а
  // лендинг двуязычный, поэтому подписи берём из словаря.
  const biasLabel = t(`landing.signal.bias.${signal.bias}`);
  const sideLabel = t(`landing.signal.side.${signal.direction}`);

  const timeZone = ianaFor(timezone);
  const l = locale === "ru" ? "ru-RU" : "en-US";
  const day = new Intl.DateTimeFormat(l, {
    day: "2-digit",
    month: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(signal.candlesTo));

  // Цены инструментов различаются на порядки (0,12 против 1066), поэтому число
  // знаков берём от величины, а не фиксируем.
  const digits = signal.levelPrice < 1 ? 5 : 2;
  const price = new Intl.NumberFormat(l, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const levelAbove = signal.levelPrice > signal.currentPrice;

  return (
    <div
      className="relative overflow-hidden rounded-xl border p-5 flex flex-col gap-3"
      style={{
        borderColor: `color-mix(in srgb, ${toneVar} 45%, transparent)`,
        background: `linear-gradient(180deg, color-mix(in srgb, ${toneVar} 10%, transparent), transparent 55%), var(--color-surface)`,
      }}
    >
      <SignalSparkline
        candles={signal.candles}
        levelPrice={signal.levelPrice}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-28 w-full opacity-30"
      />

      <div className="relative flex flex-col gap-3">
        <span className={`font-mono text-[10px] uppercase tracking-[0.16em] ${toneText}`}>
          {t("landing.signal.title")} · {day}
        </span>

        <div>
          <div className="text-2xl font-bold tracking-tight">{signal.symbol}</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums">
            <span className={toneText}>{isShort ? "↘" : "↗"}</span>
            <span className="text-[15px] font-semibold">{price.format(signal.currentPrice)}</span>
            <span className="text-xs text-faint">
              {t("landing.signal.level")} {price.format(signal.levelPrice)} ·{" "}
              {t(levelAbove ? "landing.signal.above" : "landing.signal.below", {
                n: signal.distanceAtr.toFixed(2),
              })}
            </span>
          </div>
        </div>

        <span
          className={`self-start rounded-full px-3 py-1 text-[13px] font-semibold ${toneText}`}
          style={{ background: `color-mix(in srgb, ${toneVar} 16%, transparent)` }}
        >
          {biasLabel} · {sideLabel}
        </span>

        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-muted">
            {t("landing.signal.strength", { n: signal.strength })}
          </span>
          {signal.runwayAtr !== null && (
            <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-muted">
              {t("landing.signal.runway", { n: signal.runwayAtr.toFixed(1) })}
            </span>
          )}
          {signal.contamination !== null && signal.contamination <= 0.1 && (
            <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-muted">
              {t("landing.signal.clean")}
            </span>
          )}
        </div>

        {signal.total > 1 && (
          <p className="text-xs text-faint">
            {t("landing.signal.rest", { n: signal.total - 1 })}
          </p>
        )}
      </div>
    </div>
  );
}
