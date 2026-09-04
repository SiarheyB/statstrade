// Форматирование ИГРОВОГО времени (миллисекунды с начала партии), а не
// реальных дат: в симуляторе нет календаря, есть «день 12, 09:30». Общий
// формат для графика и новостной ленты — иначе метка времени под свечой и
// метка у новости про эту же свечу выглядели бы по-разному.
export function fmtGameClock(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const day = Math.floor(totalMinutes / (24 * 60)) + 1;
  const hh = String(Math.floor((totalMinutes % (24 * 60)) / 60)).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `Д${day} ${hh}:${mm}`;
}

/**
 * Длительность игрового времени короткой подписью: «1м», «4ч», «30д». Нужна
 * для таймфреймов графика — длина свечи зависит от ускорения стиля, поэтому
 * подписать её фиксированной строкой («1 минута») нельзя.
 */
export function fmtGameDuration(ms: number): string {
  // В скальпинге игровое время идёт почти как реальное (ускорение 1x), и
  // свеча там короче минуты — без секунд все четыре таймфрейма
  // подписывались одинаковым «0м».
  if (ms < 60_000) return `${trim(ms / 1000)}с`;
  const minutes = ms / 60_000;
  if (minutes < 60) return `${trim(minutes)}м`;
  const hours = minutes / 60;
  if (hours < 24) return `${trim(hours)}ч`;
  return `${trim(hours / 24)}д`;
}

function trim(value: number): string {
  // 2.5д читается, 2.50д — нет; целые показываем без хвоста.
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}
