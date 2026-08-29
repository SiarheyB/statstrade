/**
 * Колонка кнопок таймфрейма слева от графика.
 *
 * Нужна в полноэкранном режиме: селект таймфрейма живёт в шапке страницы, а её
 * в фуллскрине не видно — без этой колонки график приходилось сворачивать ради
 * каждого переключения.
 *
 * Компонент рисует ТОЛЬКО кнопки, без своей обёртки: на карте ордеров и
 * форексе они встают внутрь панели рисования (DrawingToolbar), а на карте
 * ликвидаций рисовалок нет вовсе, и там колонка кладётся поверх canvas сама.
 * Общей остаётся разметка кнопки — иначе панели разъезжаются по виду при
 * первой же правке одной из них.
 */
"use client";

export type TimeframeItem = {
  /** Значение, которое уйдёт в onSelect (оно же ключ настроек графика). */
  value: string;
  /** Что показать на кнопке. У карты ликвидаций подписи переведённые
   *  («24ч» вместо «1d»), поэтому подпись задаётся отдельно от значения. */
  label: string;
};

type Props = {
  items: readonly TimeframeItem[];
  active: string;
  onSelect: (value: string) => void;
  /** Подсказка при наведении; получает подпись кнопки. */
  title?: (label: string) => string;
};

export default function TimeframeRail({ items, active, onSelect, title }: Props) {
  return (
    <>
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onSelect(it.value)}
          className={`flex items-center justify-center w-7 h-6 rounded text-[10px] font-medium tabular-nums transition-colors ${
            it.value === active
              ? "bg-accent/20 text-accent border border-accent/40"
              : "text-muted hover:text-fg hover:bg-bg-muted border border-transparent"
          }`}
          title={title ? title(it.label) : `Таймфрейм ${it.label}`}
          aria-pressed={it.value === active}
        >
          {it.label}
        </button>
      ))}
    </>
  );
}
