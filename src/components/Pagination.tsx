"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type PaginationProps = {
  page: number; // 1-based
  totalPages: number;
  onChange: (page: number) => void;
  prevLabel: ReactNode;
  nextLabel: ReactNode;
  pageAriaLabel?: string;
  className?: string;
};

const VISIBLE_ROWS = 10;
const ROW_H = 28; // px, совпадает с py-1.5 + text-sm строки

// Общая пагинация: prev/next + выпадающий список страниц, чтобы перейти сразу
// на нужную страницу вместо пощелкать "далее" много раз подряд. Список — свой
// (не нативный <select>): при 100-200 страницах нативный попап у разных
// браузеров/ОС ведёт себя по-разному, а так высота и прокрутка гарантированы.
export function Pagination({ page, totalPages, onChange, prevLabel, nextLabel, pageAriaLabel, className }: PaginationProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: "center" });
  }, [open]);

  if (totalPages <= 1) return null;

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`} ref={rootRef}>
      <button
        type="button"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="inline-flex items-center gap-1 px-3 py-1 rounded-lg input-base hover:border-border-strong disabled:opacity-40"
      >
        {prevLabel}
      </button>

      <div className="relative">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={pageAriaLabel}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 input-base rounded-lg px-2 py-1 text-sm tabular-nums hover:border-border-strong"
        >
          {page} / {totalPages}
          <ChevronDown size={14} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>
        {open && (
          <div
            ref={listRef}
            role="listbox"
            aria-label={pageAriaLabel}
            className="absolute z-20 bottom-full mb-1 min-w-full rounded-lg border border-border bg-bg shadow-xl overflow-y-auto"
            style={{ maxHeight: VISIBLE_ROWS * ROW_H }}
          >
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                role="option"
                aria-selected={p === page}
                data-current={p === page ? "true" : undefined}
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                }}
                className={`block w-full text-left px-3 py-1.5 text-sm tabular-nums hover:bg-surface-2 ${p === page ? "text-accent" : "text-fg"}`}
                style={{ height: ROW_H }}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="inline-flex items-center gap-1 px-3 py-1 rounded-lg input-base hover:border-border-strong disabled:opacity-40"
      >
        {nextLabel}
      </button>
    </div>
  );
}
