// Сборка ТЕКУЩЕЙ (ещё не закрытой) минутной свечи из тиков Dukascopy.
//
// Зачем отдельный модуль: index.mjs при импорте поднимает таймеры, сервер и
// пул Postgres — под тест его не затащить. Здесь только чистая функция.
//
// Почему вообще из тиков: 1MIN-бар Dukascopy появляется ТОЛЬКО после закрытия
// минуты (замерено: в 14:25:59 самый свежий бар — 14:24). То есть на графике
// последняя свеча всегда «вчерашняя», а меняется раз в минуту — на минутном
// таймфрейме это выглядит как «обновляется раз в две минуты». Тики же отстают
// на секунды, и из них та же самая свеча собирается один в один.

import { TICK_VOLUME_SCALE } from "./dukascopy.mjs";

/**
 * OHLCV минутки по тикам, попавшим в окно [from, to).
 *
 * Совпадение с закрытым баром Dukascopy проверено на живых данных
 * (EUR/USD, USD/JPY, XAU/USD): O/H/L/C сходятся точно, объём — это сумма
 * bidVol, делённая на TICK_VOLUME_SCALE.
 *
 * @param {Array<{t:number,bid:number,bidVol:number}>} ticks тики (любой порядок)
 * @param {number} from начало минуты, мс
 * @param {number} to   конец минуты (не включая), мс
 * @returns {{o:number,h:number,l:number,c:number,v:number,n:number}|null}
 *          null — в окно не попал ни один тик
 */
export function ticksToCandle(ticks, from, to) {
  const inWindow = ticks
    .filter(t => Number.isFinite(t?.t) && t.t >= from && t.t < to && Number.isFinite(t.bid))
    .sort((a, b) => a.t - b.t);
  if (inWindow.length === 0) return null;

  let h = -Infinity;
  let l = Infinity;
  let vol = 0;
  for (const t of inWindow) {
    if (t.bid > h) h = t.bid;
    if (t.bid < l) l = t.bid;
    vol += Number.isFinite(t.bidVol) ? t.bidVol : 0;
  }

  return {
    o: inWindow[0].bid,
    h,
    l,
    c: inWindow[inWindow.length - 1].bid,
    v: vol / TICK_VOLUME_SCALE,
    n: inWindow.length,
  };
}
