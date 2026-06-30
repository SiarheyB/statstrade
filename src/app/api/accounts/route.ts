import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { encrypt, decrypt, maskSecret } from "@/lib/crypto";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { bumpStatsVersion } from "@/lib/statsCache";
import { SUPPORTED_EXCHANGES, isExchangeId } from "@/lib/exchanges";

const SOURCES = ["exchange", "mt4", "mt5", "manual"] as const;

const createSchema = z.object({
  exchange: z.string().min(1).max(20),
  label: z.string().min(1, "Укажите название").max(60),
  source: z.enum(SOURCES).default("exchange"),
  accountCurrency: z.string().trim().max(8).optional(),
  apiKey: z.string().trim().max(256).optional(),
  apiSecret: z.string().trim().max(256).optional(),
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
    include: { _count: { select: { fills: true, importedTrades: true } } },
  });

  return NextResponse.json(
    accounts.map((a) => ({
      id: a.id,
      exchange: a.exchange,
      label: a.label,
      source: a.source,
      accountCurrency: a.accountCurrency,
      marketType: a.marketType,
      demoTrading: a.demoTrading,
      balance: a.balance,
      capital: a.capital,
      apiKeyMasked: a.apiKey ? maskSecret(safeDecrypt(a.apiKey)) : null,
      importedCount: a._count.importedTrades,
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

  // Build the create payload per source. CCXT exchanges need API keys; MT /
  // manual accounts are file-imported and carry no keys but an account currency.
  let createData;
  if (data.source === "exchange") {
    if (!isExchangeId(data.exchange)) return badRequest("Неподдерживаемая биржа");
    if (!data.apiKey || !data.apiSecret) return badRequest("Введите API key и secret");
    if (SUPPORTED_EXCHANGES[data.exchange].needsPassphrase && !data.passphrase) {
      return badRequest("Для OKX требуется passphrase");
    }
    createData = {
      userId: user.userId,
      exchange: data.exchange,
      label: data.label,
      source: "exchange",
      marketType: data.marketType,
      demoTrading: data.demoTrading,
      apiKey: encrypt(data.apiKey),
      apiSecret: encrypt(data.apiSecret),
      passphrase: data.passphrase ? encrypt(data.passphrase) : null,
    };
  } else {
    createData = {
      userId: user.userId,
      exchange: data.source, // mt4 | mt5 | manual (used as the display label)
      label: data.label,
      source: data.source,
      accountCurrency: (data.accountCurrency || "USD").toUpperCase(),
      assetClass: "forex",
      marketType: "both",
    };
  }

  try {
    const account = await prisma.exchangeAccount.create({ data: createData });
    bumpStatsVersion(user.userId);
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
