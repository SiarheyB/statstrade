/**
 * demoSession.ts — вход «посмотреть без регистрации».
 *
 * Гостю выдаётся обычная сессия ОБЩЕГО демо-пользователя: весь дашборд,
 * аналитика и графики работают ровно тем же кодом, что и у настоящего юзера —
 * никаких параллельных «демо-веток» в UI. Отличий ровно два:
 *
 *  1) JWT несёт claim `demo`, и middleware отклоняет от такой сессии любые
 *     изменяющие запросы (см. middleware.ts) — общий аккаунт нельзя испортить;
 *  2) в дашборде видна плашка с выходом из демо.
 *
 * Пользователь один на всех и не имеет пароля: войти в него обычной формой
 * входа нельзя (password = null → verifyPassword всегда false), только через
 * этот модуль.
 */

import { prisma } from "./db";
import { seedDemoData } from "./demo";
import { createSessionCookie, clearSessionCookie } from "./auth";

export const DEMO_EMAIL = "demo@tradestats.local";
const DEMO_ACCOUNT_LABEL = "Демо-счёт";
const DEMO_EXCHANGE = "binance";

/** Данные пересеиваются, если последнему посеву больше суток. */
const RESEED_AFTER_MS = 24 * 60 * 60 * 1000;

type DemoUser = { id: string; email: string; tokenVersion: number };

/**
 * Демо-пользователь с посеянными сделками. Создаётся при первом заходе и
 * переиспользуется дальше; данные обновляются раз в сутки, чтобы «последние
 * сделки» не уезжали в прошлое.
 */
export async function ensureDemoUser(now = Date.now()): Promise<DemoUser> {
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, name: "Демо" },
    select: { id: true, email: true, tokenVersion: true },
  });

  const account = await prisma.exchangeAccount.findFirst({
    where: { userId: user.id },
    select: { id: true, balanceAt: true },
  });

  if (!account) {
    const created = await prisma.exchangeAccount.create({
      data: {
        userId: user.id,
        exchange: DEMO_EXCHANGE,
        label: DEMO_ACCOUNT_LABEL,
        source: "manual",
        marketType: "both",
      },
      select: { id: true },
    });
    await seedDemoData(created.id, DEMO_EXCHANGE, user.id);
    return user;
  }

  // balanceAt проставляет сам seedDemoData в конце посева — используем его как
  // отметку «когда демо наполнялось в последний раз», отдельного поля не заводим.
  const seededAt = account.balanceAt?.getTime() ?? 0;
  if (now - seededAt > RESEED_AFTER_MS) {
    await seedDemoData(account.id, DEMO_EXCHANGE, user.id);
  }

  return user;
}

/** Выдать гостю демо-сессию (готовит данные, если их ещё нет). */
export async function startDemoSession(now = Date.now()): Promise<void> {
  const user = await ensureDemoUser(now);
  await createSessionCookie({ userId: user.id, email: user.email, demo: true }, user.tokenVersion);
}

/** Выход из демо — просто снять cookie, аккаунт остаётся для следующих гостей. */
export async function endDemoSession(): Promise<void> {
  await clearSessionCookie();
}
