"use client";

import type { ReactNode } from "react";

type PaginationProps = {
  page: number; // 1-based
  totalPages: number;
  onChange: (page: number) => void;
  prevLabel: ReactNode;
  nextLabel: ReactNode;
  pageAriaLabel?: string;
  className?: string;
};

// Общая пагинация: prev/next + выпадающий список страниц, чтобы перейти сразу
// на нужную страницу вместо пощелкать "далее" много раз подряд.
export function Pagination({ page, totalPages, onChange, prevLabel, nextLabel, pageAriaLabel, className }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="inline-flex items-center gap-1 px-3 py-1 rounded-lg input-base hover:border-border-strong disabled:opacity-40"
      >
        {prevLabel}
      </button>
      <select
        aria-label={pageAriaLabel}
        value={page}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input-base rounded-lg px-2 py-1 text-sm tabular-nums"
      >
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
          <option key={p} value={p}>
            {p} / {totalPages}
          </option>
        ))}
      </select>
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
