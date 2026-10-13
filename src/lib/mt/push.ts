import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { parseMtDate } from "@/lib/mt/numbers";
import type { ParsedTrade } from "@/lib/mt/types";

// Выгрузка сделок прямо из советника MT5 (TradeGridPanel).
//
// Советник не может сохранить HTML-отчёт терминала программно, поэтому он сам
// собирает закрытые позиции из истории сделок (HistorySelect/HistoryDeal*) и
// присылает их JSON-ом — ровно с теми полями, что парсер берёт из таблицы
// «Позиции» отчёта. Дальше всё идёт тем же путём, что и ручной импорт
// (lib/mt/applyImport.ts), и тикеты совпадают, так что отчёт и советник
// друг друга не задваивают.

const TOKEN_PREFIX = "tsk_";

/** Новый токен: показывается пользователю один раз, в базе — только хэш. */
export function newPushToken(): string {
  return TOKEN_PREFIX + randomBytes(24).toString("base64url");
}

export function hashPushToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Токен из заголовка `Authorization: Bearer tsk_…`; null, если формат не наш. */
export function pushTokenFromRequest(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(tsk_[A-Za-z0-9_-]{20,64})\s*$/);
  return m ? m[1] : null;
}

// Время — серверное время брокера строкой «2026.10.06 17:25:46», как в отчёте:
// parseMtDate трактует его одинаково для обоих путей, иначе сделки из отчёта и
// из советника разъехались бы на часовой пояс брокера.
const mtTime = z.string().max(32).refine((s) => parseMtDate(s) != null, "Неверное время");
const money = z.number().finite();
const price = z.number().finite().nonnegative();

const positionSchema = z.object({
  ticket: z.union([z.string().regex(/^\d{1,20}$/), z.number().int().nonnegative()]),
  symbol: z.string().trim().min(1).max(40),
  side: z.enum(["buy", "sell"]),
  lots: z.number().finite().positive(),
  openTime: mtTime,
  closeTime: mtTime,
  openPrice: price,
  closePrice: price,
  sl: price.optional().default(0),
  tp: price.optional().default(0),
  commission: money.optional().default(0),
  swap: money.optional().default(0),
  profit: money,
  comment: z.string().max(64).optional(),
});

export const pushSchema = z.object({
  // Версия формата: если формат поменяется, старые советники отличим по ней.
  v: z.literal(1),
  balance: z.number().finite().nullable().optional(),
  currency: z.string().trim().max(8).optional(),
  positions: z.array(positionSchema).max(20000),
});

export type PushPayload = z.infer<typeof pushSchema>;

export function toParsedTrades(p: PushPayload): ParsedTrade[] {
  const seen = new Set<string>();
  const out: ParsedTrade[] = [];
  for (const x of p.positions) {
    const externalId = String(x.ticket);
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    out.push({
      externalId,
      symbol: x.symbol,
      side: x.side === "buy" ? "long" : "short",
      lots: x.lots,
      entryTime: parseMtDate(x.openTime)!,
      exitTime: parseMtDate(x.closeTime)!,
      entryPrice: x.openPrice,
      exitPrice: x.closePrice,
      stopLoss: x.sl > 0 ? x.sl : null,
      takeProfit: x.tp > 0 ? x.tp : null,
      commission: x.commission,
      swap: x.swap,
      grossProfit: x.profit,
      // Как у отчёта: комментарий брокера в сделку не переносим.
      comment: null,
    });
  }
  return out;
}
