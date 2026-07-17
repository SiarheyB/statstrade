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

function log(...args: unknown[]): void {
  if (ENABLE_IMPORT_LOGS) console.info("[IMPORT]", ...args);
}

// ---------- НАЧАЛО ЛОГИРОВАНИЯ ВСЕГО ИМПОРТА ----------
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  // ЛОГИ: вход в роут
  log("=== IMPORT START ===", { url: req.url });

  const user = await getAuthUser();
  log("AUTH", { userId: user?.userId ?? null });
  if (!user) {
    log("UNAUTHORIZED", "No valid auth token");
    return unauthorized();
  }
  const { id } = params;

  const account = await prisma.exchangeAccount.findFirst({
    where: { id, userId: user.userId },
    select: { id: true, source: true, accountCurrency: true },
  });
  log("account lookup", { found: !!account, source: account?.source });
  if (!account) return badRequest("Аккаунт не найден");
  if (account.source !== "mt4" && account.source !== "mt5") {
    return badRequest("Импорт доступен только для аккаунтов MetaTrader");
  }

  // ----------  FORM DATA ----------
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    log("formData parse failed");
    return badRequest("Ожидается multipart/form-data запрос");
  }
  const file = form.get("file");
  const dryRun = form.get("dryRun") === "1";
  log("file received", {
    hasFile: file instanceof File,
    size: file instanceof File ? file.size : 0,
    dryRun,
    originalName: file instanceof File ? file.name : null
  });
  if (!(file instanceof File)) return badRequest("Файл не выбран");
  if (file.size > MAX_BYTES) return badRequest("Файл слишком большой (макс. 10 МБ)");

  const buf = Buffer.from(await file.arrayBuffer());
  log("buffer size", buf.length);
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
        log("encoding detection SUCCESS", encoding);
        break;
      }
    } catch (e) {
      log("encoding detection FAILED", encoding, (e as Error).message);
    }
  }
  if (!html) {
    html = buf.toString("utf-8");
    log("encoding fallback to utf-8");
  }
  log("decoded html length", html?.length ?? 0);

  // ----------  ПАРСИНГ ----------
  const { format, trades, balance, errors } = parseStatement(html, account.source as MtFormat);
  log("parse result", { format, tradeCount: trades.length, balance, errorCount: errors.length });
  if (trades.length === 0) {
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
  log("prepared data", {
    rowsCount: rows.length,
    batch,
    symbols,
    netTotal,
    deposit,
  });

  // ----------  ОБРОБКА dryRun ----------
  if (dryRun) {
    log("dry-run response", { parsed: rows.length, batch });
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
    log("DB upsert SUCCESS", {
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
    log("ERROR", { message: (err as Error).message });
    return serverError((err as Error).message);
  } finally {
    // LOG END
    log("END", { accountId: id });
  }
}

// -------------------------------------------------------------------
//  DELETE /api/accounts/[id]/import (откат последней партии)
// -------------------------------------------------------------------
export async function DELETE(
  _req: Request,
  { params }: { id: string },
) {
  log("DELETE START", { userId: (await getAuthUser()).userId, accountId: (await params).id });

  const user = await getAuthUser();
  if (!user) return unauthorized();

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
    log("DELETE END", { accountId: id });
  }
}