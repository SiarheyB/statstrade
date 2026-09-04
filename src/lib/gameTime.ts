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
