import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readJsonBody, serverError } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { logger } from "@/lib/logger";
import { applyImport } from "@/lib/mt/applyImport";
import { hashPushToken, pushSchema, pushTokenFromRequest, toParsedTrades } from "@/lib/mt/push";

// Полная история счёта MT5 — до нескольких тысяч позиций, ~300 байт на позицию.
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * POST /api/mt/push — выгрузка закрытых позиций из советника TradeGridPanel.
 *
 * Без cookie-сессии: авторизация — токен аккаунта в `Authorization: Bearer`.
 * Токен выдаётся в карточке MT-аккаунта (/api/accounts/[id]/push-token) и даёт
 * ровно одно право — записать сделки в этот аккаунт; ничего не отдаёт наружу.
 * Ответы короткие и плоские: их разбирает MQL5, а не браузер.
 */
export async function POST(req: Request) {
  if (!rateLimit(`mtpush:ip:${clientIp(req)}`, 30, 60_000).ok) {
    return NextResponse.json({ error: "Слишком часто, повторите через минуту" }, { status: 429 });
  }
  const token = pushTokenFromRequest(req);
  if (!token) return NextResponse.json({ error: "Нет токена" }, { status: 401 });

  const account = await prisma.exchangeAccount.findUnique({
    where: { pushTokenHash: hashPushToken(token) },
    select: { id: true, userId: true, source: true, accountCurrency: true },
  });
  if (!account) return NextResponse.json({ error: "Токен неверный или отозван" }, { status: 401 });
  if (account.source !== "mt5") {
    return NextResponse.json({ error: "Аккаунт не MT5" }, { status: 400 });
  }
  if (!rateLimit(`mtpush:acc:${account.id}`, 12, 60_000).ok) {
    return NextResponse.json({ error: "Слишком часто, повторите через минуту" }, { status: 429 });
  }

  const body = await readJsonBody(req, MAX_BYTES);
  const parsed = pushSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    logger.warn("import", account.id, "push: invalid payload", { path: issue?.path, message: issue?.message });
    return NextResponse.json(
      { error: `Неверные данные: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim() },
      { status: 400 },
    );
  }

  try {
    const trades = toParsedTrades(parsed.data);
    const r = await applyImport({
      account,
      userId: account.userId,
      trades,
      balance: parsed.data.balance ?? null,
      push: true,
    });
    logger.info("import", account.id, "push SUCCESS", {
      imported: r.imported, updated: r.updated, skipped: r.skipped, batch: r.batch,
    });
    return NextResponse.json({ imported: r.imported, updated: r.updated, skipped: r.skipped, parsed: r.parsed });
  } catch (err) {
    logger.error("import", account.id, "push: database error", { message: (err as Error).message });
    return serverError("Ошибка сохранения");
  }
}
