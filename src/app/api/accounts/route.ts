import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { encrypt, decrypt, maskSecret } from "@/lib/crypto";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { SUPPORTED_EXCHANGES, isExchangeId } from "@/lib/exchanges";

const createSchema = z.object({
  exchange: z.string().refine(isExchangeId, "Неподдерживаемая биржа"),
  label: z.string().min(1, "Укажите название").max(60),
  apiKey: z.string().trim().min(1, "Введите API key").max(256),
  apiSecret: z.string().trim().min(1, "Введите API secret").max(256),
  passphrase: z.string().trim().max(128).optional(),
  marketType: z.enum(["spot", "futures", "both"]).default("both"),
  demoTrading: z.boolean().optional().default(false),
});

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const accounts = await prisma.exchangeAccount.findMany({
    where: { userId: user.userId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { fills: true } } },
  });

  return NextResponse.json(
    accounts.map((a) => ({
      id: a.id,
      exchange: a.exchange,
      label: a.label,
      marketType: a.marketType,
      demoTrading: a.demoTrading,
      balance: a.balance,
      apiKeyMasked: maskSecret(safeDecrypt(a.apiKey)),
      lastSyncAt: a.lastSyncAt,
      syncStatus: a.syncStatus,
      syncError: a.syncError,
      syncPhase: a.syncPhase,
      syncCursor: a.syncCursor,
      syncTotal: a.syncTotal,
      syncImported: a.syncImported,
      fullSyncAt: a.fullSyncAt,
      autoSync: a.autoSync,
      syncIntervalMinutes: a.syncIntervalMinutes,
      fillCount: a._count.fills,
      createdAt: a.createdAt,
    })),
  );
}

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Проверьте данные", parsed.error.flatten().fieldErrors);
  }
  const data = parsed.data;

  if (!isExchangeId(data.exchange)) return badRequest("Неподдерживаемая биржа");
  if (SUPPORTED_EXCHANGES[data.exchange].needsPassphrase && !data.passphrase) {
    return badRequest("Для OKX требуется passphrase");
  }

  try {
    const account = await prisma.exchangeAccount.create({
      data: {
        userId: user.userId,
        exchange: data.exchange,
        label: data.label,
        marketType: data.marketType,
        demoTrading: data.demoTrading,
        apiKey: encrypt(data.apiKey),
        apiSecret: encrypt(data.apiSecret),
        passphrase: data.passphrase ? encrypt(data.passphrase) : null,
      },
    });
    return NextResponse.json({ id: account.id });
  } catch (err) {
    // FK violation = the session points at a user that no longer exists.
    if ((err as { code?: string }).code === "P2003") {
      return badRequest("Сессия устарела — выйдите и войдите снова");
    }
    return serverError((err as Error).message);
  }
}

function safeDecrypt(value: string): string {
  try {
    return decrypt(value);
  } catch {
    return "????";
  }
}
