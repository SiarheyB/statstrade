// Запись истории «риска на сделку» — серверная половина lib/riskHistory.ts
// (там чистая логика разрешения, здесь обращения к БД; чистая половина
// импортируется из тестов и из клиентских путей, куда prisma тянуть нельзя).

import { prisma } from "./db";
import { parseRiskProfile, defaultRiskProfile, riskPerTradeAmount } from "./risk";

/**
 * Фиксирует действующую стоимость 1R «с этого момента» — по строке на каждый
 * счёт пользователя.
 *
 * Почему разворачиваем профиль по умолчанию ("") на конкретные счета: 1R в
 * процентах — это процент ОТ КАПИТАЛА СЧЁТА, и у разных счетов он разный. Один
 * общий снимок пришлось бы пересчитывать по сегодняшнему капиталу, то есть
 * ровно та беда, от которой снимок и заводился.
 *
 * Новая строка пишется, ТОЛЬКО если сумма реально изменилась: сохранение
 * настроек без правки риска (поменяли лимит убытка) не должно засорять историю.
 *
 * `mode`:
 *  - "bootstrap" — вызывается ДО применения новых настроек и только если у счёта
 *    ещё нет ни одной версии: записывает ТЕКУЩИЙ (то есть прежний) риск задним
 *    числом, с начала времён. Без этой строки первая же смена риска осталась бы
 *    единственной версией, и вся история легла бы под новое значение — ровно тот
 *    баг, от которого всё затевалось.
 *  - "change" — после применения: пишет новое значение «с этого момента».
 */
export async function snapshotRiskVersions(
  userId: string,
  mode: "bootstrap" | "change" = "change",
  at: Date = new Date(),
): Promise<number> {
  const [accounts, profileRows] = await Promise.all([
    prisma.exchangeAccount.findMany({
      where: { userId },
      select: { id: true, balance: true },
    }),
    prisma.riskProfile.findMany({ where: { userId } }),
  ]);
  if (accounts.length === 0) return 0;

  const byAccount = new Map(profileRows.map((r) => [r.accountId, r]));
  const def = byAccount.has("") ? parseRiskProfile(byAccount.get("")!) : defaultRiskProfile();

  // Последняя версия каждого счёта — с чем сравнивать.
  const latest = new Map<string, number | null>();
  const existing = await prisma.riskProfileVersion.findMany({
    where: { userId, accountId: { in: accounts.map((a) => a.id) } },
    orderBy: { effectiveFrom: "asc" },
    select: { accountId: true, amount: true },
  });
  for (const v of existing) latest.set(v.accountId, v.amount);

  // Бутстрап нужен только счетам без истории: у остальных прошлое уже описано.
  const effectiveFrom = mode === "bootstrap" ? new Date(0) : at;

  const rows: {
    userId: string;
    accountId: string;
    effectiveFrom: Date;
    riskPerTrade: string;
    amount: number | null;
  }[] = [];

  for (const acc of accounts) {
    const override = byAccount.get(acc.id);
    const profile = override ? parseRiskProfile(override) : def;
    const amount = riskPerTradeAmount(profile, acc.balance);
    const prev = latest.get(acc.id);
    if (mode === "bootstrap") {
      if (prev !== undefined) continue; // история уже есть — прошлое не переписываем
    } else if (prev !== undefined && sameAmount(prev, amount)) {
      continue; // риск не менялся — версию не плодим
    }
    rows.push({
      userId,
      accountId: acc.id,
      effectiveFrom,
      riskPerTrade: JSON.stringify(profile.riskPerTrade),
      amount,
    });
  }

  if (rows.length === 0) return 0;
  await prisma.riskProfileVersion.createMany({ data: rows });
  return rows.length;
}

// Деньги сравниваем до цента: 0.5% от плавающего капитала даёт хвост из
// float-мусора, и без допуска каждое сохранение настроек плодило бы версию.
function sameAmount(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) < 0.005;
}
