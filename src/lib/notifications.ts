import { prisma } from "./db";
import { sendPushToUsers, type PushPayload } from "./push/server";

/**
 * notifications.ts — единая точка, через которую приложение сообщает
 * пользователю личную новость.
 *
 * Одно обращение делает сразу две вещи:
 *   1) кладёт строку в UserNotification — её покажет колокольчик в меню;
 *   2) отправляет push на устройства пользователя.
 *
 * Вместе, а не по отдельности, намеренно: push — это доставка, и он может не
 * дойти (нет подписки, телефон офлайн, разрешение отозвано). Колокольчик
 * отвечает на вопрос «что я пропустил», и уведомление обязано попасть туда
 * ДАЖЕ если push отправить не удалось. Поэтому запись идёт первой, а результат
 * отправки на неё не влияет.
 */

export type NotificationKind = "level_alert" | "econcal";

export type NotifyInput = {
  kind: NotificationKind;
  title: string;
  body: string;
  /** Куда вести по клику — путь внутри приложения. */
  url?: string;
  /** Ключ схлопывания push-уведомлений на экране устройства. */
  tag?: string;
};

// Сколько держим прочитанные уведомления. Колокольчик показывает непрочитанное,
// а прочитанное нужно лишь на случай «а что там было час назад».
const RETENTION_DAYS = 30;
// Чистку гоняем не чаще раза в час на процесс: уведомления пишутся пачками, и
// делать deleteMany на каждое — лишняя работа ради строк, которых единицы.
const PRUNE_EVERY_MS = 3600_000;
let lastPrune = 0;

async function pruneOld(): Promise<void> {
  const now = Date.now();
  if (now - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = now;
  const cutoff = new Date(now - RETENTION_DAYS * 86_400_000);
  await prisma.userNotification
    .deleteMany({ where: { createdAt: { lt: cutoff } } })
    .catch(() => {
      // Чистка — обслуживание, а не работа: её сбой не должен мешать
      // отправке уведомления.
    });
}

/**
 * Сообщить пользователю. Возвращает, сколько устройств получило push
 * (ноль — нормальная ситуация: в колокольчике уведомление всё равно есть).
 */
export async function notify(userId: string, input: NotifyInput): Promise<number> {
  await prisma.userNotification.create({
    data: {
      userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      url: input.url ?? null,
    },
  });

  void pruneOld();

  const payload: PushPayload = {
    title: input.title,
    body: input.body,
    url: input.url,
    tag: input.tag,
  };
  const res = await sendPushToUsers([userId], payload);
  return res.sent;
}
