"use client";

// Подсказка при наведении.
//
// Системный `title` не годится: он появляется через секунду, выглядит как
// подсказка операционной системы, не переносит длинный текст и на тач-экранах
// не показывается вовсе. А объяснять в этой игре нужно почти каждое слово:
// «вертикальная отметка», «маржа», «R-мультипликатор» — термины, которые
// человеку вне трейдинга не говорят ничего, и именно из-за них он уходит.
//
// Сделано на CSS (group-hover), без состояния: подсказка не должна вызывать
// перерисовку страницы, а на графике она висит рядом с кнопкой, по которой
// в этот момент кликают.
import type { ReactNode } from "react";

export default function Hint({
  text,
  children,
  side = "bottom",
  align = "center",
  wide = false,
  className = "",
}: {
  text: string;
  children: ReactNode;
  /** Сверху — там, где снизу нет места (нижние строки таблиц). */
  side?: "bottom" | "top";
  /**
   * Куда прижимать подсказку по горизонтали.
   *
   * У элемента, стоящего вплотную к правому краю, подсказка по центру
   * вылезает за экран и обрезается — для таких нужен «end».
   */
  align?: "center" | "start" | "end";
  /**
   * Шире обычного. Подсказка в игре — одна фраза, и узкая колонка ей идёт;
   * объяснение настройки в админке на той же ширине превращается в столбик
   * из пятнадцати строк.
   */
  wide?: boolean;
  className?: string;
}) {
  return (
    <span className={`group relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        // Показываем на наведении и на КЛАВИАТУРНОМ фокусе, но не на обычном
        // focus-within: после клика кнопка остаётся в фокусе, и подсказка
        // висела на экране, пока фокус не уйдёт куда-то ещё — по две-три
        // штуки одновременно поверх графика.
        className={`pointer-events-none absolute z-50 hidden w-max ${wide ? "max-w-[380px]" : "max-w-[240px]"} rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug tracking-normal text-fg shadow-lg group-hover:block group-has-[:focus-visible]:block ${
          side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5"
        } ${align === "end" ? "right-0" : align === "start" ? "left-0" : "left-1/2 -translate-x-1/2"}`}
      >
        {text}
      </span>
    </span>
  );
}

/**
 * Подпись с подсказкой: пунктирное подчёркивание показывает, что здесь есть
 * что почитать. Без него подсказку никто не найдёт — наводить курсор на
 * каждое слово наугад не станет никто.
 */
export function HintLabel({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Hint text={text}>
      <span className="cursor-help underline decoration-dotted decoration-from-font underline-offset-[3px]">
        {children}
      </span>
    </Hint>
  );
}
