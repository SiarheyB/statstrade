"use client";

import { useCallback, useState } from "react";
import { GLOSSARY } from "@/lib/glossary";
import { useI18n } from "@/lib/i18n/provider";

// Wraps a term and shows a localized description tooltip on hover. If the term
// isn't in the glossary it renders its children unchanged (no tooltip).
export function Term({
  name,
  desc,
  children,
  className = "",
}: {
  name?: string;
  desc?: string; // explicit description (overrides glossary lookup)
  children?: React.ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const key = name ?? (typeof children === "string" ? children : "");
  // Glossary holds the canonical term keys; the description text comes from i18n.
  const description = desc ?? (GLOSSARY[key] ? t(`term.${key}`) : undefined);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  // Реальный размер всплывашки. Раньше вместо него стояла константа 120px, и
  // подсказка в несколько строк (например, у полей риска) нижним краем уезжала
  // за экран. Замеряем при появлении: пока курсор ходит, всплывашка остаётся
  // смонтированной, и callback-ref больше не срабатывает.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const measure = useCallback((el: HTMLSpanElement | null) => {
    if (el) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  }, []);

  if (!description) return <>{children ?? key}</>;

  // Show a header only when there's a real term name to label.
  const header = name ?? (GLOSSARY[key] ? key : undefined);

  return (
    <span
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => {
        setPos(null);
        setSize(null);
      }}
      className={`cursor-help border-b border-dotted border-faint/70 ${className}`}
    >
      {children ?? key}
      {pos && (
        <span
          ref={measure}
          className="pointer-events-none fixed z-50 block max-w-xs rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs font-normal normal-case leading-snug tracking-normal text-fg shadow-lg"
          style={{
            // Прижимаем к краям вьюпорта: иначе у крайних колонок (RR) тултип
            // уходил за правый край экрана. До замера (первый кадр) считаем по
            // максимальной ширине max-w-xs = 320px.
            left: Math.max(8, Math.min(pos.x + 14, window.innerWidth - (size?.w ?? 320) - 8)),
            // Внизу экрана всплывашка переезжает НАД курсором, а не просто
            // подпирается снизу: длинную подсказку иначе не видно целиком.
            top:
              size && pos.y + 14 + size.h > window.innerHeight - 8
                ? Math.max(8, pos.y - 14 - size.h)
                : pos.y + 14,
          }}
        >
          {header && <span className="mb-0.5 block font-medium text-accent">{header}</span>}
          {description}
        </span>
      )}
    </span>
  );
}
