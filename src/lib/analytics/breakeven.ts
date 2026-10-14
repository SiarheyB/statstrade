// «Вышел в безубыток» — ручная пометка сделки (TradeAnnotation.breakeven).
//
// Зачем. Человек закрывает позицию около нуля по своей воле — например, перед
// новостями, — и в отчёте это выглядит обычным минусом: −5,32 $ свопа и спреда,
// −0.21R. Статистика считала такую сделку убытком наравне со стопом: винрейт
// падал, серия убытков росла, а счётчик стопов в риск-менеджере приближал
// дневной лимит. Решение выйти по плану наказывалось как ошибка.
//
// Что меняется, а что нет:
//   меняется   — категория результата: win / loss / breakeven. Отсюда винрейт,
//                профит-фактор, серии, статистика по паттернам и счётчик стопов.
//   НЕ меняется — деньги. netPnl, доходность, кривая капитала и просадка в R за
//                период остаются как есть: своп и спред списаны реально, и
//                цифры обязаны сходиться с выпиской брокера. В безубыток вышла
//                ПОЗИЦИЯ, а не счёт.
//
// Пометка живёт в аннотации, а не в самой сделке: строки Trade пересоздаются
// ребилдом (rebuildAccountTrades), ImportedTrade перезаписывается повторным
// импортом отчёта — и то и другое стёрло бы флаг.
//
// Читателей результата четверо (почасовые агрегаты, список сделок, статистика
// по плейбукам, /api/stats), поэтому правило собрано здесь: разойтись им
// нельзя, иначе одна и та же сделка была бы убытком на дашборде и безубытком
// в списке.

import { Prisma } from "@prisma/client";
import type { TradeResult } from "./types";

/** Категория результата с учётом ручной пометки. */
export function resultWithBreakeven(
  result: TradeResult | string,
  breakeven: boolean | null | undefined,
): TradeResult {
  if (breakeven) return "breakeven";
  return result as TradeResult;
}

/**
 * SQL-выражение «результат с учётом пометки».
 *
 * `base` — выражение, считающее результат по деньгам; `marked` — условие «эта
 * сделка помечена». Условие передаётся снаружи, потому что до пометки запросы
 * добираются по-разному: где-то дешевле присоединить TradeAnnotation, где-то —
 * подставить список уже отобранных ключей.
 */
export function resultSql(base: Prisma.Sql, marked: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`CASE WHEN ${marked} THEN 'breakeven' ELSE ${base} END`;
}

/** «Помечено» через присоединённую TradeAnnotation: LEFT JOIN даёт NULL. */
export function markedByJoin(annAlias: string): Prisma.Sql {
  return Prisma.sql`${Prisma.raw(`"${annAlias}"."breakeven"`)} IS TRUE`;
}

/**
 * «Помечено» через список ключей, отобранных в Node. Пустой список — это
 * заведомо ложное условие: `IN ()` Postgres не примет.
 */
export function markedByKeys(keyExpr: Prisma.Sql, keys: string[]): Prisma.Sql {
  if (keys.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${keyExpr} IN (${Prisma.join(keys)})`;
}

/**
 * Результат по деньгам: тот же эпсилон, что в positions.ts classify().
 * `alias` — таблица сделок; без него запрос с JOIN спотыкается о неоднозначность.
 */
export function moneyResultSql(alias: string): Prisma.Sql {
  const pnl = Prisma.raw(`"${alias}"."netPnl"`);
  return Prisma.sql`
    CASE
      WHEN ${pnl} > 1e-9 THEN 'win'
      WHEN ${pnl} < -1e-9 THEN 'loss'
      ELSE 'breakeven'
    END
  `;
}
