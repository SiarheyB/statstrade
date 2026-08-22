/**
 * FullscreenButton — «развернуть график на весь экран».
 *
 * Кладётся поверх графика (правый верхний угол) на /dashboard/forex,
 * /dashboard/orderflow и /dashboard/liqmap. Само состояние держит
 * useFullscreen — кнопка только показывает его и переключает.
 */
"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

type Props = {
  active: boolean;
  onToggle: () => void;
  className?: string;
};

export default function FullscreenButton({ active, onToggle, className }: Props) {
  const { t } = useI18n();
  const label = active ? t("chart.exitFullscreen") : t("chart.fullscreen");
  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex items-center justify-center w-7 h-7 rounded border border-border/40 bg-bg/80 backdrop-blur-sm text-muted transition-colors hover:text-fg hover:bg-bg-muted ${className ?? ""}`}
    >
      {active ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  );
}
