// Сборка CSV для выгрузки статистики.
//
// Разделитель — точка с запятой, а не запятая: Excel с русской локалью запятую
// как разделитель колонок не понимает и валит всю строку в одну ячейку.
// В начало файла идёт BOM — без него тот же Excel открывает UTF-8 как cp1251 и
// показывает кракозябры вместо кириллицы.

export const CSV_SEPARATOR = ";";
const BOM = "﻿";

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Экранируем по RFC 4180: кавычки удваиваются, поле берётся в кавычки, если
  // содержит разделитель, кавычку или перенос строки.
  if (s.includes(CSV_SEPARATOR) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [header, ...rows].map((r) => r.map(cell).join(CSV_SEPARATOR));
  // CRLF — тот же RFC 4180, так корректнее открывается в старых Excel.
  return BOM + lines.join("\r\n") + "\r\n";
}

/** Имя файла выгрузки: traffic-pages-30d-2026-08-19.csv */
export function csvFileName(what: string, period: string, now: Date = new Date()): string {
  return `traffic-${what}-${period}-${now.toISOString().slice(0, 10)}.csv`;
}
