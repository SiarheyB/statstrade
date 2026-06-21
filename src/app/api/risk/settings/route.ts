import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import {
  parseRiskProfile,
  serializeLossLimits,
  serializeRiskPerTrade,
  defaultRiskProfile,
} from "@/lib/risk";

const limitSchema = z.object({
  on: z.boolean(),
  value: z.number().min(0).max(1_000_000_000),
  unit: z.enum(["pct", "amount"]),
});
const profileSchema = z.object({
  enabled: z.boolean(),
  maxStopsPerDay: z.number().int().min(0).max(1000).nullable(),
  riskPerTrade: limitSchema.optional(),
  lossLimits: z.object({
    day: limitSchema,
    week: limitSchema,
    month: limitSchema,
    year: limitSchema,
  }),
});
const bodySchema = z.object({
  profiles: z.record(z.string().max(200), profileSchema.nullable()),
});

// GET: all risk profiles for the user as { accountId: RiskProfileData }.
// accountId "" is the default profile; always present.
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const rows = await prisma.riskProfile.findMany({ where: { userId: user.userId } });
  const profiles: Record<string, ReturnType<typeof parseRiskProfile>> = { "": defaultRiskProfile() };
  for (const r of rows) profiles[r.accountId] = parseRiskProfile(r);

  return NextResponse.json({ profiles });
}

// PUT: upsert (or delete when null) profiles. accountId "" = default.
export async function PUT(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Проверьте данные", parsed.error.flatten().fieldErrors);
  }

  try {
    for (const [accountId, prof] of Object.entries(parsed.data.profiles)) {
      if (prof === null) {
        await prisma.riskProfile.deleteMany({ where: { userId: user.userId, accountId } });
        continue;
      }
      const data = {
        enabled: prof.enabled,
        maxStopsPerDay:
          prof.maxStopsPerDay && prof.maxStopsPerDay > 0 ? prof.maxStopsPerDay : null,
        riskPerTrade: serializeRiskPerTrade(
          prof.riskPerTrade ?? { on: false, value: 0, unit: "pct" },
        ),
        lossLimits: serializeLossLimits(prof.lossLimits),
      };
      await prisma.riskProfile.upsert({
        where: { userId_accountId: { userId: user.userId, accountId } },
        create: { userId: user.userId, accountId, ...data },
        update: data,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
