import { parse } from "node-html-parser";

// Flatten every <tr> in the document into an array of trimmed cell-text arrays.
// Decodes entities and collapses &nbsp; so downstream number parsing is clean.
export function tableRows(html: string): string[][] {
  const root = parse(html);
  const rows: string[][] = [];
  for (const tr of root.querySelectorAll("tr")) {
    const cells = tr.querySelectorAll("td, th");
    if (cells.length === 0) continue;
    rows.push(cells.map((c) => c.text.replace(/ /g, " ").trim()));
  }
  return rows;
}
