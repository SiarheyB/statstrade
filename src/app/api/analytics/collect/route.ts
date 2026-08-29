// Приёмник событий посещаемости. Вызывается ТОЛЬКО изнутри — middleware шлёт
// сюда просмотр страницы на 127.0.0.1 (в edge-рантайме prisma недоступна, см.
// lib/traffic/track.ts). Наружу роут закрыт общим секретом.

import { NextResponse } from "next/server";
import { z } from "zod";
import { recordHit } from "@/lib/traffic/ingest";
import { maybeRunFastAlerts } from "@/lib/traffic/alerts";
import { ingestKey } from "@/lib/traffic/track";
import { secretEquals } from "@/lib/crypto";
import type { TrafficHit } from "@/lib/traffic/hit";

export const runtime = "nodejs";

const nullableStr = z.string().max(400).nullable().optional();

const schema = z.object({
  path: z.string().max(200),
  visitorId: z.string().max(64),
  sessionId: z.string().max(64),
  isBot: z.boolean(),
  botName: nullableStr,
  botCategory: nullableStr,
  botReason: nullableStr,
  source: z.string().max(20),
  refHost: nullableStr,
  referrer: nullableStr,
  utmSource: nullableStr,
  utmMedium: nullableStr,
  utmCampaign: nullableStr,
  device: z.string().max(20),
  browser: nullableStr,
  os: nullableStr,
  lang: nullableStr,
  country: nullableStr,
  authed: z.boolean(),
  userId: nullableStr,
  userAgent: nullableStr,
  nav: z.enum(["load", "spa"]),
  js: z.boolean().optional(),
  screen: nullableStr,
});

export async function POST(req: Request) {
  if (!secretEquals(req.headers.get("x-analytics-key"), await ingestKey())) {
    // Не 401: снаружи этого роута как бы не существует.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad payload" }, { status: 400 });

  const result = await recordHit(parsed.data as TrafficHit);
  // Между делом (не чаще раза в 15 минут) проверяем аномалии: всплеск сканеров
  // и остановку сбора. Отдельный крон ради этого не нужен, см. lib/traffic/alerts.ts.
  maybeRunFastAlerts();
  return NextResponse.json({ ok: true, result });
}
