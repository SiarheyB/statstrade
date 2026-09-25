// Раскладка страницы сделок с учётом объединённых сеток.
//
// Сервер отдаёт кластер в порядке «строка-группа, затем её позиции по времени
// входа» (см. lib/analytics/tradeList.ts). Здесь это сворачивается в то, что
// человек видит в таблице: объединённая сетка — ОДНА строка с агрегатами
// (средние цены, суммарный лот, суммарные деньги, один R).
//
// Сами позиции никуда не деваются: они показываются под описанием сделки,
// когда строку разворачивают. Отчёт брокера остаётся виден как есть, но в
// списке сделка занимает одну строку — как ей и положено.

import type { SerializedTrade } from "@/lib/types";

export type DisplayRow = {
  // Строка таблицы: либо обычная сделка, либо строка-группа с агрегатами.
  trade: SerializedTrade;
  // Позиции, свёрнутые в эту строку. Пусто у обычной сделки.
  members: SerializedTrade[];
};

export function buildDisplayRows(rows: SerializedTrade[]): DisplayRow[] {
  const out: DisplayRow[] = [];
  const byGroup = new Map<string, DisplayRow>();

  for (const r of rows) {
    if (r.isGroup && r.groupKey) {
      const row: DisplayRow = { trade: r, members: [] };
      byGroup.set(r.groupKey, row);
      out.push(row);
      continue;
    }
    const gk = r.groupKey;
    if (gk) {
      const row = byGroup.get(gk);
      // Участник без своей группы на странице быть не должен (сервер отдаёт
      // кластер целиком), но если так вышло — показываем позицию отдельной
      // строкой, а не теряем её молча.
      if (row) row.members.push(r);
      else out.push({ trade: r, members: [] });
      continue;
    }
    out.push({ trade: r, members: [] });
  }
  return out;
}

// Объединять можно только импортированные (форекс/MT) позиции, ещё не
// состоящие в группе. У крипты нетто-позиция усредняется сама при разборе
// филлов (lib/analytics/positions.ts), там объединять нечего.
export function isMergeable(tr: SerializedTrade): boolean {
  return tr.lots != null && !tr.groupKey && !tr.isGroup;
}
