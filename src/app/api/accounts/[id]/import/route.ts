import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { parseStatement } from "@/lib/mt/parse";
import { toImportedTrade } from "@/lib/mt/to-imported";
import type { MtFormat } from "@/lib/mt/types";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Import a MetaTrader 4/5 HTML report into an imported-trades account.
// dryRun=1 parses and returns a preview without writing.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const account = await prisma.exchangeAccount.findFirst({
    where: { id, userId: user.userId },
    select: { id: true, source: true, accountCurrency: true },
  });
  if (!account) return badRequest("Аккаунт не найден");
  if (account.source !== "mt4" && account.source !== "mt5") {
    return badRequest("Импорт доступен только для аккаунтов MetaTrader");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Ожидается файл отчёта");
  }
  const file = form.get("file");
  const dryRun = form.get("dryRun") === "1";
  if (!(file instanceof File)) return badRequest("Файл не выбран");
  if (file.size > MAX_BYTES) return badRequest("Файл слишком большой (макс. 10 МБ)");

  const buf = Buffer.from(await file.arrayBuffer());
  // Windows MT exports are often UTF-16LE; fall back to UTF-8 otherwise. Symbol
  // names, numbers and dates are ASCII, so this is safe for parsing either way.
  const html =
    buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");

  const { format, trades, balance, errors } = parseStatement(html, account.source as MtFormat);
  if (trades.length === 0) {
    return badRequest(errors[0] ?? "В файле не найдено закрытых сделок");
  }

  const batch = randomUUID();
  const rows = trades.map((t) => toImportedTrade(t, account, account.source, batch));
  const symbols = Array.from(new Set(rows.map((r) => r.symbol))).sort();
  const times = rows.map((r) => r.exitTime.getTime());
  const dateRange = { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)) };
  const netTotal = rows.reduce((s, r) => s + r.netPnl, 0);
  // Deposit (capital) = final balance − net trading result. Drives ROI / equity.
  const deposit =
    balance != null ? Math.round((balance - netTotal) * 100) / 100 : null;

  if (dryRun) {
    return NextResponse.json({
      preview: true,
      format,
      parsed: rows.length,
      symbols,
      dateRange,
      netTotal,
      balance,
      deposit,
      errors,
      sample: rows.slice(0, 50).map((r) => ({
        symbol: r.symbol, side: r.side, lots: r.lots,
        entryTime: r.entryTime, exitTime: r.exitTime,
        entryPrice: r.entryPrice, exitPrice: r.exitPrice,
        pips: r.pips, swap: r.swap, commission: r.commission, netPnl: r.netPnl,
      })),
    });
  }

  try {
    const res = await prisma.importedTrade.createMany({ data: rows, skipDuplicates: true });
    await prisma.exchangeAccount.update({
      where: { id: account.id },
      data: {
        lastSyncAt: new Date(),
        // Set the account's capital from the report's deposit so ROI / equity
        // use the real number instead of the 10000 default.
        ...(deposit != null && deposit > 0
          ? { balance: deposit, balanceAt: new Date() }
          : {}),
      },
    });
    return NextResponse.json({
      imported: res.count,
      skipped: rows.length - res.count,
      parsed: rows.length,
      symbols,
      dateRange,
      netTotal,
      balance,
      deposit,
      errors,
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
