import type { MtFormat } from "./types";

// Decide whether an HTML report is MT4 or MT5 from header/keyword signatures.
// MT5 reports carry a "Positions"/"Deals" section with a "Direction"/"Position"
// column; MT4 statements use "Ticket" + "Item".
export function detectFormat(html: string): MtFormat {
  const h = html.toLowerCase();
  const hasMt5 =
    h.includes("metatrader 5") ||
    h.includes("meta trader 5") ||
    (h.includes("positions") && h.includes("deals")) ||
    h.includes(">position<") ||
    h.includes(">direction<");
  const hasMt4 = h.includes(">ticket<") || (h.includes("ticket") && h.includes("item"));

  if (hasMt5 && !hasMt4) return "mt5";
  if (hasMt4 && !hasMt5) return "mt4";
  // Both/neither: prefer MT5 when a "position" column exists, else MT4.
  if (h.includes("position")) return "mt5";
  if (h.includes("ticket")) return "mt4";
  return "unknown";
}
