import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import {
  parseRiskProfile,
  serializeLossLimits,
  serializeRiskPerTrade,
  defaultRiskProfile,
  riskChangeNeedsComment,
  type PeriodLimit,
} from "@/lib/risk";
import { recomputeRRForAccount } from "@/lib/analytics/rr";
import { snapshotRiskVersions } from "@/lib/riskHistory.server";

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
  // Почему меняется риск. Обязателен, когда риск правда меняется (см. ниже);
  // при остальных правках настроек не нужен и игнорируется.
  comment: z.string().max(300).optional(),
});

const OFF: PeriodLimit = { on: false, value: 0, unit: "pct" };

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

  const comment = parsed.data.comment?.trim() || null;

  try {
    // Меняется ли риск этим сохранением — и, значит, нужен ли комментарий.
    // Проверка на сервере, а не только в форме: правило про журнал решений не
    // должно обходиться запросом мимо UI.
    const storedRows = await prisma.riskProfile.findMany({ where: { userId: user.userId } });
    const stored = new Map(storedRows.map((r) => [r.accountId, parseRiskProfile(r)]));
    const storedDefault = stored.get("") ?? defaultRiskProfile();
    const incomingDefault = parsed.data.profiles[""]?.riskPerTrade ?? storedDefault.riskPerTrade;

    const changed: string[] = [];
    for (const [accountId, prof] of Object.entries(parsed.data.profiles)) {
      // Нет своей строки у счёта — он живёт по общему профилю, с него и
      // сравниваем; у самого общего профиля предшественник — он сам.
      const prev =
        stored.get(accountId)?.riskPerTrade ??
        (accountId === "" ? OFF : storedDefault.riskPerTrade);
      // Сняли «свои настройки» у счёта — он переезжает на общий профиль, и это
      // для него такая же смена риска, как правка числа.
      const next = prof === null ? incomingDefault : prof.riskPerTrade ?? OFF;
      if (riskChangeNeedsComment(prev, next)) changed.push(accountId);
    }

    if (changed.length > 0 && !comment) {
      return badRequest("Опишите, почему вы меняете риск", { comment: ["required"] });
    }

    // Сначала — снимок ПРЕЖНЕГО риска задним числом (если истории ещё нет).
    // Порядок важен: после upsert'ов прежнее значение уже не прочитать.
    await snapshotRiskVersions(user.userId, "bootstrap");

    const changedAccountIds = new Set<string>();
    for (const [accountId, prof] of Object.entries(parsed.data.profiles)) {
      changedAccountIds.add(accountId);
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

    // Прежде чем пересчитывать R, фиксируем НОВУЮ стоимость 1R «с этого момента»
    // (RiskProfileVersion). Без этого снимка пересчёт ниже переписал бы R у всей
    // истории: сделки, закрытые с риском 0.5%, показывались бы как 1%-ные.
    await snapshotRiskVersions(user.userId, "change", new Date(), comment);

    // Риск-профиль аккаунта меняет 1R сразу для всех его сделок — пересчитываем
    // сохранённый rr. "" (профиль по умолчанию) действует на все аккаунты, у
    // которых нет своего явного override — проще и надёжнее пересчитать RR
    // для всех аккаунтов юзера, чем вычислять, у кого именно нет override.
    if (changedAccountIds.size > 0) {
      const targetAccountIds = changedAccountIds.has("")
        ? (await prisma.exchangeAccount.findMany({ where: { userId: user.userId }, select: { id: true } })).map((a) => a.id)
        : [...changedAccountIds];
      await Promise.all(targetAccountIds.map((id) => recomputeRRForAccount(id).catch(() => {})));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
