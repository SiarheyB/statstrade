"use client";

import { Children, isValidElement, useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

// Замена нативному <select>: на части систем (замечено на macOS) выпадающий
// список нативного select рисуется системным тёмным меню независимо от
// color-scheme страницы — CSS это не лечится, меню рисует не браузер, а ОС.
// Свой список полностью на наших токенах и потому всегда совпадает с темой.
//
// API нарочно совместим с нативным select: value/onChange (onChange получает
// тот же {target:{value}}, что и настоящее событие) и дети-<option> — чтобы
// заменить <select> на <Select> можно было почти без правок вызывающего кода.
type ChangeLike = { target: { value: string } };

export function Select({
  value,
  onChange,
  className = "",
  disabled,
  title,
  children,
}: {
  value: string;
  onChange: (e: ChangeLike) => void;
  className?: string;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Раскрывать вверх, если снизу до края экрана меньше места, чем список
  // реально займёт (но НЕ меньше, чем места сверху) — иначе список у нижних
  // фильтров обрезался бы о край окна вместо того, чтобы просто уйти вверх.
  const [openUp, setOpenUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function toggleOpen() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const PANEL_MAX_H = 288; // max-h-72
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUp(spaceBelow < PANEL_MAX_H && spaceAbove > spaceBelow);
    }
    setOpen((o) => !o);
  }

  const options: { value: string; label: React.ReactNode; disabled?: boolean }[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement(child)) {
      const props = child.props as { value?: unknown; children?: React.ReactNode; disabled?: boolean };
      if (props.value !== undefined) {
        options.push({ value: String(props.value), label: props.children, disabled: props.disabled });
      }
    }
  });
  const current = options.find((o) => o.value === value);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        title={title}
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center justify-between gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown size={14} className="text-faint shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute left-0 z-50 min-w-full max-h-72 overflow-y-auto rounded-lg border border-border-strong bg-surface-2 p-1 shadow-2xl ${openUp ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              disabled={o.disabled}
              onClick={() => {
                onChange({ target: { value: o.value } });
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm whitespace-nowrap hover:bg-surface transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="flex-1">{o.label}</span>
              {o.value === value && <Check size={14} className="text-accent shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
