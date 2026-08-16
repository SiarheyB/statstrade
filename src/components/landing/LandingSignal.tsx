import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { LandingSignal as Signal } from "@/lib/landing";
import { fmtSymbol } from "@/lib/format";

/**
 * «Сигнал дня» — сильнейший сетап последнего отбора. Гостю показываем ФАКТ
 * сигнала: инструмент, сторону, силу уровня и чистоту. Точка входа, уровень и
 * разбор «за/против» остаются за регистрацией — иначе рекомендация раздаётся
 * целиком и заходить в сервис незачем.
 *
 * Единственное цветное пятно лендинга: рамка и подложка в цвет стороны сделки.
 */
export default function LandingSignal({
  signal,
  symbolsScanned,
  t,
}: {
  signal: Signal | null;
  symbolsScanned: number;
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
  const Icon = isShort ? TrendingDown : TrendingUp;
  // Классы Tailwind обязаны быть литералами: динамический `text-${tone}` не
  // попадает в сборку и молча теряет цвет.
  const toneText = isShort ? "text-loss" : "text-profit";
  const toneVar = isShort ? "var(--color-loss)" : "var(--color-profit)";
  // labels.ts — только по-русски (машинные ключи БД → русский UI дашборда), а
  // лендинг двуязычный, поэтому подписи берём из словаря.
  const biasLabel = t(`landing.signal.bias.${signal.bias}`);
  const sideLabel = t(`landing.signal.side.${signal.direction}`);

  return (
    <div
      className="relative overflow-hidden rounded-xl border p-5 flex flex-col gap-3"
      style={{
        borderColor: `color-mix(in srgb, ${toneVar} 45%, transparent)`,
        background: `linear-gradient(180deg, color-mix(in srgb, ${toneVar} 10%, transparent), transparent 55%), var(--color-surface)`,
      }}
    >
      <span className={`text-[10px] uppercase tracking-[0.16em] font-mono ${toneText}`}>
        {t("landing.signal.title")}
      </span>

      <div>
        <div className="text-2xl font-bold tracking-tight">{fmtSymbol(signal.symbol)}</div>
        <div className={`mt-1 inline-flex items-center gap-1.5 text-sm ${toneText}`}>
          <Icon size={15} />
          {biasLabel} · {sideLabel}
        </div>
      </div>

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

      <Link
        href="/register"
        className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent/90"
      >
        {t("landing.signal.cta")}
      </Link>

      {signal.total > 1 && (
        <p className="text-xs text-faint">
          {t("landing.signal.rest", { n: signal.total - 1, total: symbolsScanned })}
        </p>
      )}
    </div>
  );
}
