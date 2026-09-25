// Объединение нескольких импортированных позиций в одну сделку.
//
// Зачем. У хеджинговых брокеров (MT5) сетка лимитных заявок исполняется
// НЕСКОЛЬКИМИ позициями с отдельными тикетами: пять лимиток по 0.01 лота с
// общим стопом — это пять строк ImportedTrade. По смыслу это ОДНА сделка,
// набранная лесенкой, и её суммарный стоп стоит один 1R. Без объединения
// статистика видит пять убытков вместо одного, а getNetStopsCount засчитывает
// пять стопов подряд — мгновенный выход за дневной лимит на ровном месте.
//
// Как устроено хранение (см. schema.prisma). Группа — это ОТДЕЛЬНАЯ строка
// ImportedTrade с isGroup = true и externalId вида "group:<cuid>", в которой
// лежат агрегаты; участники получают groupId = id этой строки. Такой выбор
// вместо самостоятельной таблицы сделан ради читателей статистики: /api/stats,
// hourly, rr, playbookStats, tradeReturns и mentorShare продолжают работать с
// одной моделью, и добавить нужно ровно одно условие `groupId: null` — иначе
// пришлось бы в каждом из них сводить две разные формы строк.
//
// Исходные строки при этом НЕ меняются: разгруппировать = снять groupId и
// удалить строку-группу. Отчёт брокера остаётся виден как есть — это прямое
// требование: в разделе «Сделки» человек должен видеть все пять позиций, а в
// статистику попадать должна одна.

// Порог «стопы практически совпадают» — доля от размера риска (расстояния
// вход→стоп). Ниже него разброс показывается справочно, выше — предупреждением
// в диалоге подтверждения. В долях риска, а не в пунктах: 5 пунктов для GBPJPY
// и для XAUUSD — совершенно разные величины (тот же принцип, что у порогов
// алертов в долях ATR, см. lib/recommendations).
export const STOP_SPREAD_MINOR = 0.1;

// Позиция-участник. Форма — подмножество ImportedTrade; берём только то, что
// нужно для кластеризации и свёртки, чтобы функции оставались чистыми и
// тестировались без БД.
export type GroupMember = {
  id: string;
  side: string; // long | short
  lots: number;
  qty: number;
  entryTime: Date;
  exitTime: Date;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  commission: number;
  swap: number;
  grossProfit: number;
  netPnl: number;
};

const EPS = 1e-9;

// Средневзвешенное по лотам. Взвешиваем именно по лотам, а не арифметически:
// в сетке 0.01/0.01/0.03 стоп третьей позиции должен весить втрое — иначе
// средняя врёт сильнее, чем сам разброс стопов.
function weighted(values: number[], weights: number[]): number {
  let sum = 0;
  let w = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] * weights[i];
    w += weights[i];
  }
  return w > EPS ? sum / w : 0;
}

// Разбить позиции ОДНОГО инструмента и ОДНОЙ стороны на кластеры «период
// непрерывно открытой позиции»: суммарный открытый объём растёт с каждым
// входом и падает с каждым выходом, а момент, когда он обнуляется, закрывает
// кластер.
//
// Почему именно так, а не «интервалы пересекаются». Пересечение не транзитивно:
// если A пересекается с B, а B с C, но A с C — нет, кластеризация по связности
// всё равно слепила бы A и C в одну сделку. Обнуление объёма такой ошибки не
// допускает и заодно само разделяет две сетки подряд: сетка закрылась по стопу,
// через час открыта новая — между ними был флэт, значит это разные сделки.
//
// Это тот же критерий, по которому lib/analytics/positions.ts режет крипту
// (позиция вернулась к нулю — сделка закрыта); разница лишь в том, что здесь
// ничего не склеивается автоматически, а только предлагается пользователю.
export function clusterByFlat(members: GroupMember[]): GroupMember[][] {
  type Ev = { ms: number; delta: number; open: GroupMember | null };
  const events: Ev[] = [];
  for (const m of members) {
    events.push({ ms: m.entryTime.getTime(), delta: m.lots, open: m });
    events.push({ ms: m.exitTime.getTime(), delta: -m.lots, open: null });
  }
  // При совпадении времени закрытия применяются ПЕРВЫМИ. MT5 пишет время с
  // точностью до секунды, и новая позиция, открытая в ту же секунду, что
  // закрылась предыдущая, иначе не дала бы объёму обнулиться — две разные
  // сделки слиплись бы в одну.
  events.sort((a, b) => a.ms - b.ms || a.delta - b.delta);

  const clusters: GroupMember[][] = [];
  let current: GroupMember[] = [];
  let open = 0;
  for (const ev of events) {
    open += ev.delta;
    if (ev.open) current.push(ev.open);
    if (Math.abs(open) < EPS && current.length > 0) {
      clusters.push(current);
      current = [];
    }
  }
  // Незакрытого остатка быть не должно (в ImportedTrade только закрытые
  // round-trip'ы), но если данные битые — не теряем их молча.
  if (current.length > 0) clusters.push(current);
  return clusters;
}

// Кандидаты на объединение: кластеры из двух и более позиций. Разбивка идёт по
// (символ, сторона) — long и short на одном инструменте в одну группу не
// сводятся никогда: у такой пары нет осмысленной средней цены входа, а у
// брокера пользователя встречный хедж и не открывается.
export function findGroupCandidates(
  members: (GroupMember & { symbol: string })[],
): (GroupMember & { symbol: string })[][] {
  const buckets = new Map<string, (GroupMember & { symbol: string })[]>();
  for (const m of members) {
    const key = `${m.symbol}|${m.side}`;
    const arr = buckets.get(key);
    if (arr) arr.push(m);
    else buckets.set(key, [m]);
  }
  const out: (GroupMember & { symbol: string })[][] = [];
  for (const arr of buckets.values()) {
    for (const cluster of clusterByFlat(arr)) {
      if (cluster.length > 1) {
        out.push(cluster as (GroupMember & { symbol: string })[]);
      }
    }
  }
  out.sort((a, b) => a[0].entryTime.getTime() - b[0].entryTime.getTime());
  return out;
}

export type GroupAggregate = {
  side: string;
  lots: number;
  qty: number;
  entryTime: Date;
  exitTime: Date;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  commission: number;
  swap: number;
  grossProfit: number;
  netPnl: number;
  memberCount: number;
  // Разброс стопов в долях риска; null — стопа нет ни у одной позиции.
  stopSpread: number | null;
  stopMin: number | null;
  stopMax: number | null;
};

// Свернуть кластер в одну сделку.
//
// Деньги (grossProfit, swap, commission, netPnl) берутся СУММОЙ от брокера и по
// ценам не пересчитываются — ровно как в toImportedTrade, который доверяет
// отчёту. Из усреднённых цен выводится только риск (расстояние вход→стоп), то
// есть разброс стопов бьёт по одной величине — R, а не по деньгам.
export function aggregateGroup(members: GroupMember[]): GroupAggregate {
  const lots = members.map((m) => m.lots);
  const totalLots = lots.reduce((s, v) => s + v, 0);
  const entryPrice = weighted(members.map((m) => m.entryPrice), lots);
  const exitPrice = weighted(members.map((m) => m.exitPrice), lots);

  // Стоп и тейк усредняются только по тем позициям, где они заданы: у части
  // сетки стопа может не быть, и подстановка нуля увела бы среднюю в мусор.
  const withStop = members.filter((m) => m.stopLoss != null);
  const stopLoss = withStop.length
    ? weighted(withStop.map((m) => m.stopLoss as number), withStop.map((m) => m.lots))
    : null;
  const withTp = members.filter((m) => m.takeProfit != null);
  const takeProfit = withTp.length
    ? weighted(withTp.map((m) => m.takeProfit as number), withTp.map((m) => m.lots))
    : null;

  const stops = withStop.map((m) => m.stopLoss as number);
  const stopMin = stops.length ? Math.min(...stops) : null;
  const stopMax = stops.length ? Math.max(...stops) : null;
  const risk = stopLoss != null ? Math.abs(entryPrice - stopLoss) : 0;
  const stopSpread =
    stopMin != null && stopMax != null && risk > EPS ? (stopMax - stopMin) / risk : null;

  return {
    side: members[0].side,
    lots: totalLots,
    qty: members.reduce((s, m) => s + m.qty, 0),
    entryTime: new Date(Math.min(...members.map((m) => m.entryTime.getTime()))),
    exitTime: new Date(Math.max(...members.map((m) => m.exitTime.getTime()))),
    entryPrice,
    exitPrice,
    stopLoss,
    takeProfit,
    commission: members.reduce((s, m) => s + m.commission, 0),
    swap: members.reduce((s, m) => s + m.swap, 0),
    grossProfit: members.reduce((s, m) => s + m.grossProfit, 0),
    netPnl: members.reduce((s, m) => s + m.netPnl, 0),
    memberCount: members.length,
    stopSpread,
    stopMin,
    stopMax,
  };
}

// Уровень предупреждения о разбросе стопов. Объединить можно ВСЕГДА — разброс
// влияет только на то, насколько точным получится R, и человек должен это
// видеть до подтверждения, а не гадать.
export type SpreadLevel = "exact" | "minor" | "warn";

export function spreadLevel(spread: number | null): SpreadLevel {
  if (spread == null || spread < EPS) return "exact";
  return spread <= STOP_SPREAD_MINOR ? "minor" : "warn";
}

// Можно ли объединить выбранное. Единственный жёсткий запрет — разные стороны:
// у long+short нет осмысленной средней цены входа.
export function validateSelection(
  members: (GroupMember & { symbol: string })[],
): { ok: boolean; reason?: "tooFew" | "mixedSides" | "mixedSymbols" } {
  if (members.length < 2) return { ok: false, reason: "tooFew" };
  if (members.some((m) => m.symbol !== members[0].symbol)) {
    return { ok: false, reason: "mixedSymbols" };
  }
  if (members.some((m) => m.side !== members[0].side)) {
    return { ok: false, reason: "mixedSides" };
  }
  return { ok: true };
}
