import type { MtFormat } from "./types";

// Decide whether an HTML report is MT4 or MT5 from header/keyword signatures.
// MT5 reports carry a "Positions"/"Deals" section with a "Direction"/"Position"
// column; MT4 statements use "Ticket" + "Item".
//
// Терминал сохраняет отчёт на языке интерфейса, и в русской выгрузке нет ни
// одного английского слова: разделы называются «Позиции», «Ордера», «Сделки»,
// колонки — «Позиция», «Направление», «Тикет», «Инструмент». Без этих синонимов
// русский отчёт (ReportHistory из MT5, UTF-16) не опознавался вовсе — импорт
// отвечал «Не удалось определить формат отчёта». Колонки внутри таблиц
// parse.ts уже сопоставляет по обоим языкам.
export function detectFormat(html: string): MtFormat {
  const h = html.toLowerCase();
  const hasMt5 =
    h.includes("metatrader 5") ||
    h.includes("meta trader 5") ||
    (h.includes("positions") && h.includes("deals")) ||
    (h.includes("позиции") && h.includes("сделки")) ||
    h.includes(">position<") ||
    h.includes(">позиция<") ||
    h.includes(">direction<") ||
    h.includes(">направление<");
  const hasMt4 =
    h.includes(">ticket<") ||
    h.includes(">тикет<") ||
    (h.includes("ticket") && h.includes("item")) ||
    (h.includes("тикет") && h.includes("инструмент"));

  if (hasMt5 && !hasMt4) return "mt5";
  if (hasMt4 && !hasMt5) return "mt4";
  // Both/neither: prefer MT5 when a "position" column exists, else MT4.
  if (h.includes("position") || h.includes("позици")) return "mt5";
  if (h.includes("ticket") || h.includes("тикет")) return "mt4";
  return "unknown";
}
