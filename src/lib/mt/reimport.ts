import type { ImportedTradeInput } from "./to-imported";

/**
 * reimport.ts — что делать с повторно загруженным отчётом MetaTrader.
 *
 * Зачем это нужно. MT5 при ЧАСТИЧНОМ закрытии позиции не заводит вторую
 * строку: в отчёте остаётся та же позиция с тем же тикетом, но пересчитанными
 * значениями — время закрытия последней части, СРЕДНЕВЗВЕШЕННАЯ цена выхода,
 * суммарные объём/профит/своп/комиссия. Пример с живого отчёта: GBPCAD, тикет
 * 31868700 — после закрытия первой половины в выгрузке стояло 1.87149 и
 * +34.56, после закрытия остатка в той же строке уже 1.87208 и +56.70.
 *
 * Раньше запись шла через `createMany({ skipDuplicates: true })`, а он смотрит
 * только на `externalId`. Тикет прежний — строка молча пропускалась, импорт
 * рапортовал «0 сделок», и в журнале навсегда оставалась половина сделки: со
 * старой ценой выхода, половинным объёмом и, как следствие, сломанным R.
 *
 * Поэтому повторный импорт не пропускает знакомый тикет, а СРАВНИВАЕТ его с
 * тем, что уже лежит в базе, и обновляет изменившееся. Тогда любая схема
 * частичных закрытий — хоть две части, хоть пять — сходится сама собой:
 * брокер каждый раз отдаёт актуальный итог по позиции, и нам достаточно его
 * записать.
 *
 * Ручные пометки пользователя (свой стоп, ТВХ, паттерн, ошибки, комментарий,
 * скриншот) тут не при чём — они лежат в отдельной таблице TradeAnnotation с
 * ключом `accountId:тикет`. Тикет при частичном закрытии не меняется, поэтому
 * пометки переживают обновление сами, без единой строчки кода здесь.
 */

/** Поля строки в базе, по которым решается, изменилась ли сделка. */
export type ExistingTrade = {
  id: string;
  externalId: string;
  symbol: string;
  side: string;
  lots: number;
  qty: number;
  contractSize: number;
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
  pips: number | null;
  comment: string | null;
};

/** Поля, которые перезаписывает повторный импорт. */
export type TradeUpdate = Omit<
  ImportedTradeInput,
  "accountId" | "source" | "externalId" | "currency" | "importBatch"
>;

export type ImportDiff = {
  /** Сделки, которых в базе ещё нет. */
  create: ImportedTradeInput[];
  /** Знакомые сделки, у которых брокер изменил цифры. */
  update: { id: string; externalId: string; data: TradeUpdate; changed: string[] }[];
  /** Сколько знакомых сделок пришло без единого изменения. */
  unchanged: number;
};

/**
 * Допуск при сравнении чисел.
 *
 * Цены, объёмы и деньги проходят через double и наш же расчёт (netPnl, qty,
 * pips), поэтому байт-в-байт совпадения ждать не стоит. 1e-9 меньше любой
 * значащей величины в отчёте — самый мелкий шаг цены у брокеров это 1e-5, а
 * денег 0.01 — и при этом заведомо больше шума округления.
 */
const EPS = 1e-9;

function sameNumber(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.isFinite(a) === Number.isFinite(b);
  return Math.abs(a - b) < EPS;
}

function sameTime(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

/**
 * Что изменилось у знакомой сделки. Пустой список — сделка та же, трогать базу
 * не за чем.
 *
 * Названия полей возвращаются наружу не ради красоты: по ним видно в логах,
 * ПОЧЕМУ строка переписалась, и «дозакрыли объём» отличается от «брокер
 * поправил своп задним числом».
 */
export function changedFields(row: ImportedTradeInput, existing: ExistingTrade): string[] {
  const changed: string[] = [];
  const num = (key: keyof ExistingTrade & keyof ImportedTradeInput) => {
    if (!sameNumber(row[key] as number | null, existing[key] as number | null)) changed.push(key);
  };

  if (row.symbol !== existing.symbol) changed.push("symbol");
  if (row.side !== existing.side) changed.push("side");
  num("lots");
  num("qty");
  num("contractSize");
  if (!sameTime(row.entryTime, existing.entryTime)) changed.push("entryTime");
  if (!sameTime(row.exitTime, existing.exitTime)) changed.push("exitTime");
  num("entryPrice");
  num("exitPrice");
  num("stopLoss");
  num("takeProfit");
  num("commission");
  num("swap");
  num("grossProfit");
  num("netPnl");
  num("pips");
  // Пустой комментарий и отсутствие комментария — одно и то же: брокеры
  // пишут в это поле то "", то ничего, и различать их значило бы переписывать
  // строку на каждом импорте без причины.
  if ((row.comment ?? "") !== (existing.comment ?? "")) changed.push("comment");

  return changed;
}

function toUpdate(row: ImportedTradeInput): TradeUpdate {
  return {
    symbol: row.symbol,
    base: row.base,
    quote: row.quote,
    market: row.market,
    side: row.side,
    lots: row.lots,
    qty: row.qty,
    contractSize: row.contractSize,
    entryTime: row.entryTime,
    exitTime: row.exitTime,
    entryPrice: row.entryPrice,
    exitPrice: row.exitPrice,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,
    commission: row.commission,
    swap: row.swap,
    grossProfit: row.grossProfit,
    netPnl: row.netPnl,
    pips: row.pips,
    comment: row.comment,
  };
}

/**
 * Разложить разобранный отчёт на «создать», «обновить» и «не трогать».
 *
 * `existing` — строки этого же счёта, уже лежащие в базе. Сопоставление идёт
 * по externalId (тикет позиции), он же уникален в паре с accountId.
 */
export function diffImport(
  rows: ImportedTradeInput[],
  existing: ExistingTrade[],
): ImportDiff {
  const byExternalId = new Map(existing.map((e) => [e.externalId, e]));
  const diff: ImportDiff = { create: [], update: [], unchanged: 0 };

  for (const row of rows) {
    const prev = byExternalId.get(row.externalId);
    if (!prev) {
      diff.create.push(row);
      continue;
    }
    const changed = changedFields(row, prev);
    if (changed.length === 0) {
      diff.unchanged++;
      continue;
    }
    diff.update.push({ id: prev.id, externalId: row.externalId, data: toUpdate(row), changed });
  }

  return diff;
}
