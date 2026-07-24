"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, Star } from "lucide-react";
import clsx from "clsx";

// A searchable dropdown: shows the current value, opens a filterable list (type
// to search, scrolls after ~10 rows). Used for long option lists like symbols.
export default function SearchSelect({
  value,
  options,
  allValue = "all",
  allLabel,
  placeholder,
  onChange,
  renderLabel = (v) => v,
  className = "",
  hideAll = false,
  favorites,
  onToggleFavorite,
  emptyText,
  favAddLabel,
  favRemoveLabel,
}: {
  value: string;
  options: string[];
  allValue?: string;
  allLabel: string;
  placeholder?: string;
  onChange: (v: string) => void;
  renderLabel?: (v: string) => string;
  className?: string;
  hideAll?: boolean;
  favorites?: string[];
  onToggleFavorite?: (symbol: string) => void;
  emptyText?: string;
  favAddLabel?: string;
  favRemoveLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => renderLabel(o).toLowerCase().includes(q) || o.toLowerCase().includes(q))
    : options;
  // Sort favourites to the top (preserving original order within each group).
  const favSet = new Set(favorites ?? []);
  const sorted = [...filtered].sort((a, b) => {
    const af = favSet.has(a) ? 0 : 1;
    const bf = favSet.has(b) ? 0 : 1;
    return af - bf;
  });
  const display = value === allValue ? allLabel : renderLabel(value);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`input-base text-sm py-1.5 cursor-pointer inline-flex items-center gap-2 ${className}`}
      >
        <span className="truncate max-w-[10rem]">{display}</span>
        <ChevronDown size={14} className="text-faint shrink-0" />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-56 rounded-lg border border-border bg-bg shadow-xl overflow-hidden">
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
            <Search size={13} className="text-faint shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {!hideAll && (
              <Option active={value === allValue} onClick={() => pick(allValue)}>
                {allLabel}
              </Option>
            )}
            {sorted.map((o) => {
              const isFav = favSet.has(o);
              return (
                <div key={o} className="flex items-center group">
                  <Option active={value === o} onClick={() => pick(o)} className="flex-1 min-w-0">
                    <span className="truncate">{renderLabel(o)}</span>
                  </Option>
                  {onToggleFavorite && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onToggleFavorite(o); }}
                      className={clsx("shrink-0 px-2 py-1.5 hover:text-accent transition", isFav ? "text-accent" : "text-faint opacity-0 group-hover:opacity-100")}
                      title={isFav ? favRemoveLabel : favAddLabel}
                    >
                      <Star size={13} className={isFav ? "fill-accent text-accent" : ""} />
                    </button>
                  )}
                </div>
              );
            })}
            {sorted.length === 0 && (
              <div className="px-3 py-2 text-xs text-faint">{emptyText ?? "—"}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Option({
  active,
  onClick,
  children,
  className = "",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-surface-2 ${className} ${
        active ? "text-accent" : "text-fg"
      }`}
    >
      {children}
    </button>
  );
}
