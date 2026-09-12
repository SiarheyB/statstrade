import webpush from "web-push";
import { prisma } from "./db";
import { getFeatureConfig } from "./featureConfig";
import { pushConfigured } from "./push/server";
import {
  dueAlerts,
  groupByTime,
  normalizeAlertSettings,
  type AlertEvent,
} from "./econcalAlerts";

/**
 * econcalPushRunner.ts — напоминания о скором выходе новости, приходящие при
 * ЗАКРЫТОЙ вкладке.
 *
 * Второй канал к тому же, что делает components/EconCalAlerts.tsx. Тот рисует
 * всплывашку в открытой вкладке и живёт целиком в браузере; здесь то же самое
 * считает сервер и отправляет push. Логика выбора рубежей общая и лежит в
 * lib/econcalAlerts.ts (dueAlerts/groupByTime) — расходиться этим двум каналам
 * нельзя, иначе человек получал бы разные напоминания с разных устройств.
 *
 * Настройки берутся из КОПИИ, которую устройство прислало в свою строку
 * PushSubscription: localStorage кроном не читается.
 */

// Горизонт выборки событий: чуть больше самого дальнего рубежа (15 минут).
const LOOKAHEAD_MS = 30 * 60_000;
// Сколько времени помним отправленный рубеж. Столько же, сколько браузерная
// половина (ALERT_SEEN_KEY живёт 6 часов).
const SEEN_TTL_MS = 6 * 3600_000;
// Сколько событий пачки перечисляем в теле уведомления; остальные — счётчиком.
const MAX_LISTED = 3;

export type EconPushResult = {
  /** Сколько устройств с включёнными напоминаниями просмотрено. */
  devices: number;
  /** Сколько уведомлений отправлено. */
  sent: number;
  /** Сколько мёртвых подписок удалено по дороге. */
  removed: number;
};

function parseSeen(raw: string | null, now: number): Map<string, number> {
  const map = new Map<string, number>();
  if (!raw) return map;
  try {
    for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, number>)) {
      // Заодно чистим просроченное: иначе колонка росла бы вечно, по записи
      // на каждый рубеж каждого события.
      if (typeof v === "number" && v > now - SEEN_TTL_MS) map.set(k, v);
    }
  } catch {
    // Битый JSON — начинаем с чистого листа, это лишь дедупликация.
  }
  return map;
}

/** Текст одного уведомления на ПАЧКУ событий с общим временем публикации. */
function textFor(events: AlertEvent[], minutesLeft: number): { title: string; body: string } {
  const listed = events.slice(0, MAX_LISTED).map((e) => `${e.currency} · ${e.title}`);
  const rest = events.length - listed.length;
  return {
    title:
      minutesLeft <= 0
        ? "Выходит сейчас"
        : `Через ${minutesLeft} мин: ${events.length > 1 ? `${events.length} события` : events[0].currency}`,
    body: listed.join("\n") + (rest > 0 ? `\nи ещё ${rest}` : ""),
  };
}

export async function runEconcalPush(now: number = Date.now()): Promise<EconPushResult> {
  const result: EconPushResult = { devices: 0, sent: 0, removed: 0 };
  if (!pushConfigured()) return result;

  // Календарь выключен в админке — напоминать не о чем. Проверяем до всего
  // остального: это общий рубильник раздела (см. econcal.ts).
  const { enabled } = await getFeatureConfig("econcal");
  if (!enabled) return result;

  // Подписки с настройками: устройство, которое ни разу не сохраняло
  // напоминания, в выборку не попадает вовсе.
  const subs = await prisma.pushSubscription.findMany({ where: { econcalPrefs: { not: null } } });
  if (subs.length === 0) return result;

  const rows = await prisma.economicEvent.findMany({
    where: { time: { gte: new Date(now - 60_000), lte: new Date(now + LOOKAHEAD_MS) } },
    orderBy: { time: "asc" },
  });
  if (rows.length === 0) return result;

  const events: AlertEvent[] = rows.map((e) => ({
    id: e.id,
    time: e.time.toISOString(),
    currency: e.currency,
    title: e.title,
    impact: e.impact,
    forecast: e.forecast,
    previous: e.previous,
  }));

  const dead: string[] = [];
  // Уведомление в колокольчик — ОДНО на пользователя и пачку событий, сколько
  // бы устройств у него ни было подписано: push идёт на каждое устройство (в
  // этом его смысл), а колокольчик один, и три одинаковые строки в нём — это
  // не «надёжнее», а мусор.
  const inboxDone = new Set<string>();

  for (const sub of subs) {
    const settings = normalizeAlertSettings(JSON.parse(sub.econcalPrefs ?? "null"));
    if (!settings.enabled) continue;
    result.devices++;

    const seen = parseSeen(sub.econcalSeen, now);
    const due = dueAlerts(events, settings, now, new Set(seen.keys()));
    if (due.length === 0) continue;

    // Одно уведомление на пачку событий с общим временем: в 15:30 у США
    // регулярно выходит три-четыре показателя, и это одна новость для
    // трейдера, а не четыре карточки на экране телефона.
    const groups = groupByTime(due);
    for (const g of groups) {
      const minutesLeft = Math.max(0, Math.round((Date.parse(g.time) - now) / 60_000));
      const text = textFor(g.events, minutesLeft);

      const inboxKey = `${sub.userId}|${g.time}`;
      if (!inboxDone.has(inboxKey)) {
        inboxDone.add(inboxKey);
        // Пишем прямо в таблицу, а не через notify(): push отсюда уходит сам,
        // адресно на КАЖДОЕ подписанное устройство со своими настройками, и
        // notify() отправил бы его повторно на все разом.
        await prisma.userNotification.create({
          data: {
            userId: sub.userId,
            kind: "econcal",
            title: text.title,
            body: text.body,
            url: "/dashboard/econcal",
          },
        });
      }

      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            ...text,
            url: "/dashboard/econcal",
            // tag по времени публикации: напоминание за 5 минут заменит на
            // экране напоминание за 15 по тому же событию.
            tag: `econcal-${g.time}`,
          }),
          // TTL по остатку до публикации: напоминание «через 5 минут»,
          // доставленное через час, только раздражает.
          { TTL: Math.max(60, minutesLeft * 60) },
        );
        result.sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(sub.id);
        // Прочие ошибки — временные; следующая минута попробует снова, и
        // рубеж ниже НЕ гасится, чтобы напоминание не потерялось.
        continue;
      }
    }

    // Гасим ВСЕ пройденные рубежи события разом, а не только сработавший:
    // иначе человек с рубежами 15/10/5 получил бы за три минуты до NFP три
    // уведомления подряд. Та же логика, что в браузерной половине.
    for (const d of due) for (const key of d.keys) seen.set(key, now);
    await prisma.pushSubscription.update({
      where: { id: sub.id },
      data: { econcalSeen: JSON.stringify(Object.fromEntries(seen)) },
    });
  }

  if (dead.length) {
    const { count } = await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } });
    result.removed = count;
  }
  return result;
}
