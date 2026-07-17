import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { bumpStatsVersion } from "@/lib/statsCache";
import { parseStatement } from "@/lib/mt/parse";
import { toImportedTrade } from "@/lib/mt/to-imported";
import type { MtFormat } from "@/lib/mt/types";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Логи импорта включаются переменной окружения ENABLE_IMPORT_LOGS=true
// (в .env / .env.production / docker-compose). По умолчанию — выключены.
const ENABLE_IMPORT_LOGS = process.env.ENABLE_IMPORT_LOGS === "true";

function log(...args: unknown[]) {
  if (ENABLE_IMPORT_LOGS) console.info("[IMPORT]", ...args);
}

// Import a MetaTrader 4/5 HTML report into an imported-trades account.
// dryRun=1 parses and returns a preview without writing.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await params;

  // ===== START =====
  log("START", { userId: user.userId, accountId: id });

  const account = await prisma.exchangeAccount.findFirst({
    where: { id, userId: user.userId },
    select: { id: true, source: true, accountCurrency: true },
  });
  log("account lookup", { found: !!account, source: account?.source });
  if (!account) return badRequest("Аккаунт не найден");
  if (account.source !== "mt4" && account.source !== "mt5") {
    return badRequest("Импорт доступен только для аккаунтов MetaTrader");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    log("formData parse failed");
    return badRequest("Ожидается файл отчёта");
  }
  const file = form.get("file");
  const dryRun = form.get("dryRun") === "1";
  log("file received", {
    hasFile: file instanceof File,
    size: file instanceof File ? file.size : 0,
    dryRun,
  });
  if (!(file instanceof File)) return badRequest("Файл не выбран");
  if (file.size > MAX_BYTES) return badRequest("Файл слишком большой (макс. 10 МБ)");

  const buf = Buffer.from(await file.arrayBuffer());
  // Windows MT exports are often UTF-16LE; fall back to UTF-8 otherwise. Symbol
  // names, numbers and dates are ASCII, so this is safe for parsing either way.
  let html: string | undefined;
  const encodings = ["utf-8", "utf-16le", "windows-1251", "utf-16be"];
  for (const encoding of encodings) {
    try {
      let decoded: string;
      if (encoding === "utf-8" || encoding === "utf-16le") {
        decoded = buf.toString(encoding);
      } else {
        decoded = new TextDecoder(encoding).decode(buf);
      }
      if (
        decoded.includes("Ticket") ||
        decoded.includes("Тикет") ||
        decoded.includes("Open Time") ||
        decoded.includes("Время открытия") ||
        decoded.includes("Symbol") ||
        decoded.includes("Символ") ||
        decoded.includes("Close Time") ||
        decoded.includes("Время закрытия")
      ) {
        html = decoded;
        log("encoding detected", encoding);
        break;
      }
    } catch (e) {
      log("encoding failed", encoding, (e as Error).message);
    }
  }
  if (!html) {
    html = buf.toString("utf-8");
    log("encoding fallback to utf-8");
  }

  const { format, trades, balance, errors } = parseStatement(
    html,
    account.source as MtFormat,
  );
  log("parsed", { format, tradeCount: trades.length, balance, errorCount: errors.length });
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
  log("prepared rows", { rowCount: rows.length, netTotal, deposit, symbols });

  if (dryRun) {
    log("DRY-RUN response", { parsed: rows.length, batch });
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
          ? { balance: deposit, balanceAt: new Date(), capital: deposit }
          : {}),
      },
    });
    bumpStatsVersion(user.userId);
    log("SUCCESS", {
      imported: res.count,
      skipped: rows.length - res.count,
      batch,
      netTotal,
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
    log("ERROR", { message: (err as Error).message });
    return serverError((err as Error).message);
  } finally {
    // ===== STOP =====
    log("END", { accountId: id });
  }
}

// Roll back the most recent import batch for the account.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await params;

  // ===== START =====
  log("DELETE START", { userId: user.userId, accountId: id });

  const account = await prisma.exchangeAccount.findFirst({
    where: { id, userId: user.userId },
    select: { id: true },
  });
  log("account lookup", { found: !!account });
  if (!account) return badRequest("Аккаунт не найден");

  const latest = await prisma.importedTrade.findFirst({
    where: { accountId: id, importBatch: { not: null } },
    orderBy: { importedAt: "desc" },
    select: { importBatch: true },
  });
  log("latest batch", { batch: latest?.importBatch ?? null });
  if (!latest?.importBatch) return badRequest("Нет загрузок для отката");

  try {
    const res = await prisma.importedTrade.deleteMany({
      where: { accountId: id, importBatch: latest.importBatch },
    });
    bumpStatsVersion(user.userId);
    log("DELETE SUCCESS", { deleted: res.count, batch: latest.importBatch });
    return NextResponse.json({ deleted: res.count });
  } catch (err) {
    log("DELETE ERROR", { message: (err as Error).message });
    return serverError((err as Error).message);
  } finally {
    // ===== STOP =====
    log("DELETE END", { accountId: id });
  }
}
