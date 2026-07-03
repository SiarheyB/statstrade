import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";
import { isExchangeId } from "@/lib/exchanges";
import { getAllExchangeToggles } from "@/lib/exchangeToggle";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const exchanges = await getAllExchangeToggles();
    return NextResponse.json({ exchanges });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// Можно менять либо enabled, либо demoEnabled (или оба).
const schema = z
  .object({
    exchange: z.string().min(2).max(20),
    enabled: z.boolean().optional(),
    demoEnabled: z.boolean().optional(),
  })
  .refine((v) => v.enabled !== undefined || v.demoEnabled !== undefined, {
    message: "Нужно указать enabled или demoEnabled",
  });

export async function PUT(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Проверьте данные");
  const { exchange, enabled, demoEnabled } = parsed.data;
  if (!isExchangeId(exchange)) return badRequest("Неизвестная биржа");

  const data: { enabled?: boolean; demoEnabled?: boolean } = {};
  if (enabled !== undefined) data.enabled = enabled;
  if (demoEnabled !== undefined) data.demoEnabled = demoEnabled;

  try {
    await prisma.exchangeToggle.upsert({
      where: { exchange },
      create: { exchange, enabled: enabled ?? true, demoEnabled: demoEnabled ?? null },
      update: data,
    });
    await recordAudit(session, "exchange.toggle", {
      targetType: "ExchangeToggle",
      targetId: exchange,
      detail: Object.entries(data).map(([k, v]) => `${k}=${v}`).join(", "),
    });
    const exchanges = await getAllExchangeToggles();
    return NextResponse.json({ exchanges });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
