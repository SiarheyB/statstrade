import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest } from "@/lib/api";
import { parseStatement } from "@/lib/mt/parse";
import { toImportedTrade } from "@/lib/mt/to-imported";
import type { MtFormat } from "@/lib/mt/types";

const MAX_BYTES = 10 * 1024 * 1024;

// Stateless preview: parse an uploaded MT report and return a summary without
// touching the database, so the user can confirm before an account is created.
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Ожидается файл отчёта");
  }
  const file = form.get("file");
  const source = String(form.get("source") || "");
  const currency = (String(form.get("accountCurrency") || "USD") || "USD").toUpperCase();
  if (!(file instanceof File)) return badRequest("Файл не выбран");
  if (file.size > MAX_BYTES) return badRequest("Файл слишком большой (макс. 10 МБ)");
  const hint: MtFormat = source === "mt4" || source === "mt5" ? source : "unknown";

  const buf = Buffer.from(await file.arrayBuffer());
  const html =
    buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");

  const { format, trades, balance, errors } = parseStatement(html, hint);
  if (trades.length === 0) {
    return badRequest(errors[0] ?? "В файле не найдено закрытых сделок");
  }

  const rows = trades.map((t) =>
    toImportedTrade(t, { id: "", accountCurrency: currency }, format, "preview"),
  );
  const symbols = Array.from(new Set(rows.map((r) => r.symbol))).sort();
  const times = rows.map((r) => r.exitTime.getTime());
  const netTotal = rows.reduce((s, r) => s + r.netPnl, 0);
  const deposit = balance != null ? Math.round((balance - netTotal) * 100) / 100 : null;

  return NextResponse.json({
    format,
    parsed: rows.length,
    symbols,
    dateRange: { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)) },
    netTotal,
    balance,
    deposit,
    errors,
    sample: rows.slice(0, 30).map((r) => ({
      symbol: r.symbol, side: r.side, lots: r.lots,
      exitTime: r.exitTime, pips: r.pips, netPnl: r.netPnl,
    })),
  });
}
