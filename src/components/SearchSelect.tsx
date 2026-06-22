"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

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
}: {
  value: string;
  options: string[];
  allValue?: string;
  allLabel: string;
  placeholder?: string;
  onChange: (v: string) => void;
  renderLabel?: (v: string) => string;
  className?: string;
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
            <Option active={value === allValue} onClick={() => pick(allValue)}>
              {allLabel}
            </Option>
            {filtered.map((o) => (
              <Option key={o} active={value === o} onClick={() => pick(o)}>
                {renderLabel(o)}
              </Option>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-faint">—</div>
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
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-surface-2 ${
        active ? "text-accent" : "text-fg"
      }`}
    >
      {children}
    </button>
  );
}
