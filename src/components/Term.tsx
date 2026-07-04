"use client";

import { useState } from "react";
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

  if (!description) return <>{children ?? key}</>;

  // Show a header only when there's a real term name to label.
  const header = name ?? (GLOSSARY[key] ? key : undefined);

  return (
    <span
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
      className={`cursor-help border-b border-dotted border-faint/70 ${className}`}
    >
      {children ?? key}
      {pos && (
        <span
          className="pointer-events-none fixed z-50 block max-w-xs rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs font-normal normal-case leading-snug tracking-normal text-fg shadow-lg"
          style={{
            // Прижимаем к краям вьюпорта: max-w-xs = 320px + отступ, иначе у
            // крайних колонок (RR) тултип уходил за правый край экрана.
            left: Math.max(8, Math.min(pos.x + 14, window.innerWidth - 336)),
            top: Math.min(pos.y + 14, window.innerHeight - 120),
          }}
        >
          {header && <span className="mb-0.5 block font-medium text-accent">{header}</span>}
          {description}
        </span>
      )}
    </span>
  );
}
