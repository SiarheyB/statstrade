"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

/** Сколько знаков после запятой достаточно, чтобы шаг тика не терялся. */
export function decimalsOf(tickSize: number): number {
  const s = tickSize.toString();
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

/**
 * Поле цены (лимит/стоп, стоп-лосс, тейк-профит) со своими стрелками вместо
 * нативного спиннера `<input type="number">`.
 *
 * Нативный спиннер на пустом поле шагает от нуля: первый клик по стрелке
 * вверх при шаге 0.01 даёт «0.01» — цифру, которая не имеет отношения ни к
 * инструменту, ни к его цене, и с которой невозможно понять, что вообще
 * происходит (ровно так на плоском `type="number"` было на уже открытой
 * позиции в PositionsPanel — там же, где ставят стоп/тейк, а не только при
 * входе). Свои стрелки решают это так, как ожидает трейдер: пустое поле +
 * стрелка → текущая рыночная цена, дальше — шаг вверх/вниз от неё размером
 * в tickSize инструмента (не плоские «0.01» одни на всех — цена биткоина и
 * цена акции по три доллара живут в разных масштабах).
 */
export function PriceStepInput({
  value,
  onChange,
  onBlur,
  onEnter,
  price,
  tickSize,
  placeholder,
  testId,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  /** Enter — явное подтверждение (сохранить), а не просто «убрать фокус». */
  onEnter?: () => void;
  price: number | undefined;
  tickSize: number;
  placeholder?: string;
  testId?: string;
  className?: string;
}) {
  const decimals = decimalsOf(tickSize);
  function step(dir: 1 | -1) {
    const current = value.trim() === "" ? price : Number(value);
    if (current == null || !Number.isFinite(current)) return;
    const next = Math.max(0, current + dir * tickSize);
    onChange(next.toFixed(decimals));
  }
  return (
    <div className={`input-base flex items-stretch overflow-hidden p-0 ${className}`}>
      <input
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (onEnter) onEnter();
            else (e.target as HTMLInputElement).blur();
          }
        }}
        data-testid={testId}
        className="w-full min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm tabular-nums outline-none"
      />
      <div className="flex flex-col border-l border-border">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => step(1)}
          className="flex-1 px-1.5 text-faint hover:bg-surface-2 hover:text-fg"
          aria-label="+"
        >
          <ChevronUp size={11} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => step(-1)}
          className="flex-1 border-t border-border px-1.5 text-faint hover:bg-surface-2 hover:text-fg"
          aria-label="-"
        >
          <ChevronDown size={11} />
        </button>
      </div>
    </div>
  );
}
