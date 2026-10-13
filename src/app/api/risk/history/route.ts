import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import type { PeriodLimit } from "@/lib/risk";

// История риска на сделку — журнал решений для /dashboard/settings/risk.
//
// Читает RiskProfileVersion (см. lib/riskHistory.server.ts). Строки там
// появляются по трём разным поводам, и для человека это ТРИ РАЗНЫХ события,
// поэтому вид считается здесь, а не хранится в БД:
//
//   initial — бутстрап (effectiveFrom = эпоха): «так было до того, как мы
//             начали вести историю». Решения за этим нет.
//   setup   — риск включили впервые (до этого его не было). Комментарий тут
//             не требуется — это не «поменял риск», а «завёл», и помечать
//             такую строку как «без комментария» значило бы врать о причине
//             его отсутствия.
//   change  — человек поправил процент/сумму в настройках. Только у таких
//             строк есть и требуется комментарий.
//   auto    — настройки те же, а 1R в деньгах переехал сам вслед за капиталом
//             счёта. Показываем приглушённо: объяснять тут нечего.
//
// Отличить change от auto можно только сравнением с ПРЕДЫДУЩЕЙ строкой того же
// счёта — ни по комментарию (его может не быть у первого включения риска), ни
// по сумме (она меняется и сама) это не определяется.

const MAX_ENTRIES = 200;

type Entry = {
  id: string;
  accountId: string;
  accountLabel: string;
  effectiveFrom: string;
  amount: number | null;
  riskPerTrade: PeriodLimit | null;
  prevAmount: number | null;
  prevRiskPerTrade: PeriodLimit | null;
  comment: string | null;
  kind: "initial" | "setup" | "change" | "auto";
};

function parseLimit(raw: string | null): PeriodLimit | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PeriodLimit>;
    return {
      on: !!v.on,
      value: Number.isFinite(Number(v.value)) ? Number(v.value) : 0,
      unit: v.unit === "amount" ? "amount" : "pct",
    };
  } catch {
    return null;
  }
}

function sameLimit(a: PeriodLimit | null, b: PeriodLimit | null): boolean {
  if (!a || !b) return a === b;
  return a.on === b.on && a.value === b.value && a.unit === b.unit;
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  try {
    const [rows, accounts] = await Promise.all([
      prisma.riskProfileVersion.findMany({
        where: { userId: user.userId },
        // По возрастанию — чтобы знать предыдущую версию счёта; наружу отдаём
        // наоборот, свежие сверху.
        orderBy: { effectiveFrom: "asc" },
        select: {
          id: true,
          accountId: true,
          effectiveFrom: true,
          amount: true,
          riskPerTrade: true,
          comment: true,
        },
      }),
      prisma.exchangeAccount.findMany({
        where: { userId: user.userId },
        select: { id: true, label: true },
      }),
    ]);

    const labels = new Map(accounts.map((a) => [a.id, a.label]));
    const prevOf = new Map<string, { amount: number | null; limit: PeriodLimit | null }>();
    const entries: Entry[] = [];

    for (const r of rows) {
      const limit = parseLimit(r.riskPerTrade);
      const prev = prevOf.get(r.accountId);
      const on = (l: PeriodLimit | null) => !!l && l.on && l.value > 0;
      const kind: Entry["kind"] =
        r.effectiveFrom.getTime() === 0 || !prev
          ? "initial"
          : sameLimit(prev.limit, limit)
            ? "auto"
            : !on(prev.limit) && on(limit)
              ? "setup"
              : "change";
      entries.push({
        id: r.id,
        accountId: r.accountId,
        accountLabel: labels.get(r.accountId) ?? r.accountId,
        effectiveFrom: r.effectiveFrom.toISOString(),
        amount: r.amount,
        riskPerTrade: limit,
        prevAmount: prev?.amount ?? null,
        prevRiskPerTrade: prev?.limit ?? null,
        comment: r.comment,
        kind,
      });
      prevOf.set(r.accountId, { amount: r.amount, limit });
    }

    entries.reverse();
    return NextResponse.json({ entries: entries.slice(0, MAX_ENTRIES) });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
