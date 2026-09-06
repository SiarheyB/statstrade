// Расписание торгов игрового рынка.
//
// Зачем оно вообще: игровое время идёт вровень с реальным, поэтому игрок
// держит нашу вкладку рядом со своим терминалом и сравнивает. Круглосуточный
// EUR/USD в субботу — первое, что он замечает и после чего перестаёт верить
// остальному. Часы взяты те же, что у настоящего рынка, и совпадают с
// `src/lib/forexMarket.ts`, по которому живёт форекс-раздел проекта.
//
// Побочный, но главный по важности эффект — ГЭПЫ. Рынок стоял двое суток,
// а мир за эти двое суток жил: новости копились. Открытие со скачком делает
// выходные не паузой, а событием, к которому готовятся.
//
// Крипта торгуется всегда — и это становится её отличием от остальных
// рынков, а не совпадением: единственное место, где можно торговать в
// воскресенье, и единственное, где ночной разрыв не спасает от убытка.
import type { AssetClass } from "@/engine/entities/types";

export type MarketSession = "always" | "forex" | "exchange";

/** Какому расписанию подчиняется класс инструментов. */
export function sessionOf(assetClass: AssetClass): MarketSession {
  switch (assetClass) {
    case "crypto":
      return "always";
    // Металлы и нефть торгуются на том же круглосуточном будничном контуре,
    // что и валюта, — как у настоящих CFD-брокеров.
    case "forex":
    case "commodity":
      return "forex";
    default:
      return "exchange";
  }
}

// Биржевая сессия: 14:00–21:00 UTC, будни. Это 9:30–16:00 по Нью-Йорку в
// летнее время, округлённое до целых часов. Округление не косметика: часовой
// ряд — костяк всей истории (см. marketGen), и сессия, начинающаяся в 13:30,
// дала бы получасовой бар, который не собрать ни в 4h, ни в день.
// Переход на зимнее время сознательно не моделируем: сдвиг на час дважды в
// год игроку ничего не даёт, а сломать может многое.
export const EXCHANGE_OPEN_HOUR_UTC = 14;
export const EXCHANGE_CLOSE_HOUR_UTC = 21;

// Форекс: воскресенье 22:00 UTC → пятница 21:00 UTC.
export const FOREX_OPEN_DAY = 0;
export const FOREX_OPEN_HOUR_UTC = 22;
export const FOREX_CLOSE_DAY = 5;
export const FOREX_CLOSE_HOUR_UTC = 21;

/** Открыт ли рынок этого класса в момент `ts`. */
export function isMarketOpen(assetClass: AssetClass, ts: number): boolean {
  const session = sessionOf(assetClass);
  if (session === "always") return true;

  const date = new Date(ts);
  const day = date.getUTCDay();
  const hour = date.getUTCHours();

  if (session === "exchange") {
    if (day === 0 || day === 6) return false;
    return hour >= EXCHANGE_OPEN_HOUR_UTC && hour < EXCHANGE_CLOSE_HOUR_UTC;
  }

  // Форекс: неделя одним куском, поэтому проверяем не «часы дня», а границы
  // недели. Суббота выпадает целиком.
  if (day === 6) return false;
  if (day === FOREX_OPEN_DAY) return hour >= FOREX_OPEN_HOUR_UTC;
  if (day === FOREX_CLOSE_DAY) return hour < FOREX_CLOSE_HOUR_UTC;
  return true;
}

/**
 * Когда рынок откроется, если сейчас закрыт (и `ts`, если открыт).
 *
 * Шаг в час, а не поиск формулой: границы недели и суток пересекаются
 * по-разному у двух расписаний, и перебор здесь дешевле любой хитрости —
 * максимум 48 итераций до ближайшего открытия.
 */
export function nextOpen(assetClass: AssetClass, ts: number): number {
  if (isMarketOpen(assetClass, ts)) return ts;
  const MS_HOUR = 3_600_000;
  let cursor = Math.floor(ts / MS_HOUR) * MS_HOUR + MS_HOUR;
  for (let i = 0; i < 24 * 8; i++) {
    if (isMarketOpen(assetClass, cursor)) return cursor;
    cursor += MS_HOUR;
  }
  return cursor;
}
