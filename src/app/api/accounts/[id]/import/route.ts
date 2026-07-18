import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { bumpStatsVersion } from "@/lib/statsCache";
import { parseStatement } from "@/lib/mt/parse";
import { toImportedTrade } from "@/lib/mt/to-imported";
import type { MtFormat } from "@/lib/mt/types";
import { logger } from "@/lib/logger";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// ---------- НАЧАЛО ЛОГИРОВАНИЯ ВСЕГО ИМПОРТА ----------
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startTime = Date.now();
  // ЛОГИ: вход в роут
  logger.info("import", null, "=== IMPORT START ===", { url: req.url });

  const user = await getAuthUser();
  logger.info("import", user?.userId ?? null, "AUTH", { userId: user?.userId ?? null });
  if (!user) {
    logger.warn("import", null, "UNAUTHORIZED", { reason: "No valid auth token" });
    return unauthorized();
  }
  const { id } = await params;

  const account = await prisma.exchangeAccount.findFirst({
    where: { id, userId: user.userId },
    select: { id: true, source: true, accountCurrency: true },
  });
  logger.info("import", account?.id ?? null, "account lookup", { found: !!account, source: account?.source });
  if (!account) {
    logger.warn("import", user.userId, "Account not found", { accountId: id });
    return badRequest("Аккаунт не найден");
  }
  if (account.source !== "mt4" && account.source !== "mt5") {
    logger.warn("import", account.id, "Invalid account source for import", { source: account.source });
    return badRequest("Импорт доступен только для аккаунтов MetaTrader");
  }

  // ----------  FORM DATA ----------
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    logger.error("import", account.id, "formData parse failed", {});
    return badRequest("Ожидается multipart/form-data запрос");
  }
  const file = form.get("file");
  const dryRun = form.get("dryRun") === "1";
  logger.info("import", account.id, "file received", {
    hasFile: file instanceof File,
    size: file instanceof File ? file.size : 0,
    dryRun,
    originalName: file instanceof File ? file.name : null
  });
  if (!(file instanceof File)) {
    logger.error("import", account.id, "File not provided in request", {});
    return badRequest("Файл не выбран");
  }
  if (file.size > MAX_BYTES) {
    logger.error("import", account.id, "File too large", { size: file.size, max: MAX_BYTES });
    return badRequest("Файл слишком большой (макс. 10 МБ)");
  }

  const buf = Buffer.from(await file.arrayBuffer());
  logger.info("import", account.id, "buffer size", buf.length);
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
        logger.info("import", account.id, "encoding detection SUCCESS", { encoding });
        break;
      }
    } catch (e) {
      logger.warn("import", account.id, "encoding detection FAILED", { encoding, error: (e as Error).message });
    }
  }
  if (!html) {
    html = buf.toString("utf-8");
    logger.info("import", account.id, "encoding fallback to utf-8");
  }
  logger.info("import", account.id, "decoded html length", html?.length ?? 0);

  // ----------  ПАРСИНГ ----------
  const { format, trades, balance, errors } = parseStatement(html, account.source as MtFormat);
  logger.info("import", account.id, "parse result", { format, tradeCount: trades.length, balance, errorCount: errors.length });
  if (trades.length === 0) {
    logger.error("import", account.id, "No closed trades found in file", { errors });
    return badRequest(errors[0] ?? "В файле не найдено закрытых сделок");
  }

  // ----------  ПОДГОТОВКА ДАННЫХ ----------
  const batch = randomUUID();
  const rows = trades.map((t) => toImportedTrade(t, account, account.source, batch));
  const symbols = Array.from(new Set(rows.map((r) => r.symbol))).sort();
  const times = rows.map((r) => r.exitTime.getTime());
  const dateRange: { from: Date; to: Date } = {
    from: new Date(Math.min(...times)),
    to: new Date(Math.max(...times))
  };
  const netTotal = rows.reduce((s, r) => s + r.netPnl, 0);
  const deposit = balance != null ? Math.round((balance - netTotal) * 100) / 100 : null;
  logger.info("import", account.id, "prepared data", {
    rowsCount: rows.length,
    batch,
    symbols,
    netTotal,
    deposit,
  });

  // ----------  ОБРАБОТКА dryRun ----------
  if (dryRun) {
    logger.info("import", account.id, "dry-run response", { parsed: rows.length, batch });
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

  // ----------  ЗАПИСЬ В БАЗУ ----------
  try {
    const res = await prisma.importedTrade.createMany({ data: rows, skipDuplicates: true });
    await prisma.exchangeAccount.update({
      where: { id: account.id },
      data: {
        lastSyncAt: new Date(),
        ...(deposit != null && deposit > 0
          ? { balance: deposit, balanceAt: new Date(), capital: deposit }
          : {}),
      },
    });
    bumpStatsVersion(user.userId);
    logger.info("import", account.id, "DB upsert SUCCESS", {
      imported: res.count,
      skipped: rows.length - res.count,
      batch,
      netTotal: rows.reduce((s, r) => s + r.netPnl, 0)
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
    logger.error("import", account.id, "Database error during import", {
      message: (err as Error).message,
      stack: (err as Error).stack
    });
    return serverError((err as Error).message);
  } finally {
    // LOG END
    logger.info("import", account?.id ?? null, "IMPORT_END", {
      accountId: id,
      durationMs: Date.now() - startTime
    });
  }
}

// -------------------------------------------------------------------
//  DELETE /api/accounts/[id]/import (откат последней партии)
// -------------------------------------------------------------------
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await params;
  logger.info("import", user.userId, "DELETE_START", { userId: user.userId, accountId: id });

  const account = await prisma.exchangeAccount.findFirst({
    where: { id, userId: user.userId },
    select: { id: true },
  });
  logger.info("import", account?.id ?? null, "account lookup", { found: !!account });
  if (!account) {
    logger.warn("import", user.userId, "Account not found for DELETE", { accountId: id });
    return badRequest("Аккаунт не найден");
  }

  const latest = await prisma.importedTrade.findFirst({
    where: { accountId: id, importBatch: { not: null } },
    orderBy: { importedAt: "desc" },
    select: { importBatch: true },
  });
  logger.info("import", account.id, "latest batch", { batch: latest?.importBatch ?? null });
  if (!latest?.importBatch) {
    logger.warn("import", account.id, "No imports found for rollback", { accountId: id });
    return badRequest("Нет загрузок для отката");
  }

  try {
    const res = await prisma.importedTrade.deleteMany({
      where: { accountId: id, importBatch: latest.importBatch },
    });
    bumpStatsVersion(user.userId);
    logger.info("import", account.id, "DELETE_SUCCESS", { deleted: res.count, batch: latest.importBatch });
    return NextResponse.json({ deleted: res.count });
  } catch (err) {
    logger.error("import", account.id, "Database error during DELETE", { message: (err as Error).message });
    return serverError((err as Error).message);
  } finally {
    logger.info("import", account?.id ?? null, "DELETE_END", { accountId: id });
  }
}