// История «риска на сделку» (1R): какая стоимость 1R действовала на момент
// закрытия конкретной сделки.
//
// Зачем это отдельно от RiskProfile. В профиле лежит ОДНО текущее значение, да
// ещё и в процентах от ТЕКУЩЕГО капитала — то есть до появления этого модуля
// перевод риска с 0.5% на 1% молча делил пополам R у всей истории: ожидание,
// R-кривая и счётчик «чистых стопов» пересчитывались задним числом. Профиль
// отвечает на вопрос «чем я рискую сейчас», история — «чем я рисковал тогда».
//
// Порядок разрешения для сделки, закрытой в момент `at`:
//   1) последняя версия с effectiveFrom <= at (для аккаунта, иначе — общая "");
//   2) если версий на этот момент нет (сделка старше первой записи, или их
//      вообще нет) — текущий профиль, как и раньше.
//
// Границы: версия действует НА и ПОСЛЕ своего effectiveFrom. Настройки
// сохраняются «с этого момента», поэтому сделка, закрытая ДО сохранения,
// остаётся на прежнем риске — именно этого и ждёт человек, меняющий риск.

import { riskPerTradeAmount, type RiskProfileData } from "./risk";

export type RiskVersion = {
  accountId: string;
  effectiveFrom: Date;
  amount: number | null;
};

export type RiskResolver = (accountId: string, at: Date | null | undefined) => number | null;

/**
 * Собирает резолвер 1R по версиям аккаунта и профилю «как сейчас».
 *
 * `versions` — строки RiskProfileVersion для этого юзера по аккаунту и по ""
 * (общий профиль). Порядок не важен: сортируем сами.
 */
export function buildRiskResolver(
  versions: RiskVersion[],
  profiles: Record<string, RiskProfileData>,
  balance: number | null,
): RiskResolver {
  const byAccount = new Map<string, RiskVersion[]>();
  for (const v of versions) {
    const arr = byAccount.get(v.accountId) ?? [];
    arr.push(v);
    byAccount.set(v.accountId, arr);
  }
  for (const arr of byAccount.values()) {
    arr.sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  }

  const currentAmount = (accountId: string): number | null => {
    const prof = profiles[accountId] ?? profiles[""];
    if (!prof) return null;
    return riskPerTradeAmount(prof, balance);
  };

  return (accountId, at) => {
    if (!at) return currentAmount(accountId);
    const ts = at.getTime();
    // Свой профиль аккаунта важнее общего — как и в tradeRR.
    for (const key of [accountId, ""]) {
      const arr = byAccount.get(key);
      if (!arr || arr.length === 0) continue;
      let found: RiskVersion | null = null;
      for (const v of arr) {
        if (v.effectiveFrom.getTime() <= ts) found = v;
        else break;
      }
      // Версия найдена, но без суммы (риск был выключен) — это ЗНАЧИМЫЙ ответ
      // «1R тогда не был задан», а не повод лезть в текущий профиль.
      if (found) return found.amount && found.amount > 0 ? found.amount : null;
      // Сделка старше первой версии этого профиля — пробуем общий, потом текущее.
    }
    return currentAmount(accountId);
  };
}

/** Резолвер-заглушка: всегда текущий профиль (нет истории — прежнее поведение). */
export function currentOnlyResolver(
  profiles: Record<string, RiskProfileData>,
  balance: number | null,
): RiskResolver {
  return buildRiskResolver([], profiles, balance);
}
