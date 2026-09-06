"use client";

// Часы для UI, зависящего от расписания торгов.
//
// Читать `Date.now()` прямо в рендере нельзя (React справедливо считает это
// нечистотой: результат меняется между рендерами сам по себе), да и мало:
// компонент должен переключиться в «рынок открыт» в ту секунду, когда рынок
// открылся, а не когда игрок случайно кликнет и вызовет перерисовку.
import { useEffect, useState } from "react";

/** Текущее время, обновляемое раз в `intervalMs`. */
export function useMarketClock(intervalMs = 15_000): number {
  // Первое значение — 0, а не Date.now(): страница рендерится и на сервере,
  // и разное время на сервере и клиенте дало бы расхождение гидратации.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
