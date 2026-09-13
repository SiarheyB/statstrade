// Хелпер для тестов, которые раньше делали
// fireEvent.change(getByDisplayValue(...), { target: { value } }) на нативном
// <select>. Он заменён на components/Select.tsx — кнопка + список
// кнопок-опций (нативный select в Safari/macOS рисует системное тёмное меню
// поверх светлой темы, а собственный список всегда на наших токенах). Хелпер
// эмулирует тот же сценарий: открыть список по текущему значению кнопки,
// дождаться, пока он реально смонтируется (на странице тут же перерисовка от
// эффектов, и клик по опции синхронно следом за открытием иногда попадал в
// ещё не отрисованный список), кликнуть нужный пункт.
import { screen, fireEvent, waitFor } from "@testing-library/react";

export async function pickOption(currentLabel: string | RegExp, optionLabel: string | RegExp): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: currentLabel }));
  const option = await waitFor(() => screen.getByRole("option", { name: optionLabel }));
  fireEvent.click(option);
}

// Когда несколько селектов на странице по умолчанию показывают одинаковый
// текст (например «Всё» и там, и там) — currentLabel неоднозначен, и нужно
// открыть КОНКРЕТНЫЙ триггер по индексу среди всех с таким текстом.
export async function pickOptionAt(
  index: number,
  currentLabel: string | RegExp,
  optionLabel: string | RegExp,
): Promise<void> {
  fireEvent.click(screen.getAllByRole("button", { name: currentLabel })[index]);
  const option = await waitFor(() => screen.getByRole("option", { name: optionLabel }));
  fireEvent.click(option);
}
