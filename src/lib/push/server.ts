import webpush from "web-push";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/errorLog";

/**
 * Отправка web push — общий слой для всех уведомлений приложения
 * (подход цены к уровню, скорый выход новости).
 *
 * Почему push, а не Notification API: тот живёт только пока открыта вкладка
 * (так работают EconCalAlerts). Уведомление «цена подошла к уровню» ценно ровно
 * тем, что приходит, когда человек НЕ смотрит в терминал, — а это возможно
 * только через service worker и сервер проталкивания браузера.
 *
 * Ключи VAPID — это удостоверение НАШЕГО сервера перед push-сервисами Google,
 * Mozilla и Apple. Пара генерируется один раз (`npx web-push generate-vapid-keys`)
 * и кладётся в .env; менять её нельзя — все существующие подписки браузеров
 * привязаны к публичному ключу и после смены молча перестанут работать.
 */

export type PushPayload = {
  title: string;
  body: string;
  /** Куда вести по клику (путь внутри приложения). */
  url?: string;
  /** Ключ схлопывания: уведомление с тем же tag заменяет предыдущее, а не
   *  ложится вторым. Спасает от пачки одинаковых карточек на телефоне. */
  tag?: string;
};

let configured: boolean | null = null;

/**
 * Настроены ли ключи. Отдельная функция, а не бросок исключения: приложение
 * обязано работать и без push (локальная разработка, сервер без ключей) —
 * тогда кнопка подписки просто не предлагается.
 */
export function pushConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    configured = false;
    return false;
  }
  // mailto: в subject требует спецификация VAPID — push-сервису нужен контакт
  // владельца на случай проблем с отправкой.
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@tradingstat.ru";
  try {
    webpush.setVapidDetails(subject, pub, priv);
    configured = true;
  } catch (err) {
    logError(`VAPID-ключи заданы, но недействительны: ${(err as Error).message}`, {
      path: "lib/push/server",
    });
    configured = false;
  }
  return configured;
}

/** Публичный ключ для браузера (он передаётся в PushManager.subscribe). */
export function publicVapidKey(): string | null {
  return pushConfigured() ? (process.env.VAPID_PUBLIC_KEY ?? null) : null;
}

// Сколько подряд идущих отказов терпим, прежде чем удалить подписку. Одна
// осечка — это чаще всего временная недоступность push-сервиса, а не мёртвый
// браузер; удалять из-за неё значит молча отписать живого человека.
const MAX_FAILS = 5;

export type PushResult = { sent: number; failed: number; removed: number };

/**
 * Разослать одно уведомление на ВСЕ устройства перечисленных пользователей.
 *
 * 404/410 от push-сервиса — это «подписки больше нет» (снесли браузер, отозвали
 * разрешение). Такую строку удаляем сразу: она уже никогда не оживёт, а
 * висеть в каждой рассылке будет вечно. Остальные ошибки считаем временными и
 * копим в failCount.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: 0, removed: 0 };
  if (!pushConfigured() || userIds.length === 0) return result;

  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: [...new Set(userIds)] } },
  });
  if (subs.length === 0) return result;

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  const failed: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          // TTL: сколько push-сервис хранит уведомление, если устройство
          // офлайн. Час — верхняя граница осмысленности «цена подходит к
          // уровню»: через сутки она там уже не стоит.
          { TTL: 3600 },
        );
        result.sent++;
        if (s.failCount > 0 || !s.lastOkAt) {
          await prisma.pushSubscription.update({
            where: { id: s.id },
            data: { lastOkAt: new Date(), failCount: 0 },
          });
        } else {
          await prisma.pushSubscription.update({
            where: { id: s.id },
            data: { lastOkAt: new Date() },
          });
        }
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        result.failed++;
        if (status === 404 || status === 410 || s.failCount + 1 >= MAX_FAILS) dead.push(s.id);
        else failed.push(s.id);
      }
    }),
  );

  if (dead.length) {
    const { count } = await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } });
    result.removed = count;
  }
  if (failed.length) {
    await prisma.pushSubscription.updateMany({
      where: { id: { in: failed } },
      data: { failCount: { increment: 1 } },
    });
  }
  return result;
}
