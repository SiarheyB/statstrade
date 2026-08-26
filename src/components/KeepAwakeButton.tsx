/**
 * KeepAwakeButton — «не гасить экран, пока открыт график».
 *
 * Кладётся рядом с FullscreenButton (правый верхний угол графика) на
 * /dashboard/forex, /dashboard/orderflow и /dashboard/liqmap. Состояние и сама
 * блокировка — в useWakeLock; кнопка только показывает и переключает.
 *
 * Если браузер не умеет Screen Wake Lock (или страница открыта не по https),
 * кнопки нет вовсе: обещать то, чего не будет, хуже, чем промолчать.
 */
"use client";

import { MonitorOff, MonitorUp } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useWakeLock } from "@/lib/useWakeLock";

export default function KeepAwakeButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const { supported, enabled, active, toggle } = useWakeLock();

  if (!supported) return null;

  const label = enabled
    ? active
      ? t("chart.keepAwakeOn")
      : t("chart.keepAwakePaused")
    : t("chart.keepAwakeOff");

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={enabled}
      className={`flex items-center justify-center w-7 h-7 rounded border border-border/40 bg-bg/80 backdrop-blur-sm transition-colors hover:bg-bg-muted ${
        enabled ? "text-accent hover:text-accent" : "text-muted hover:text-fg"
      } ${className ?? ""}`}
    >
      {enabled ? <MonitorUp size={14} /> : <MonitorOff size={14} />}
    </button>
  );
}
