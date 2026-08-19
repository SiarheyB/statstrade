// Оповещения по трафику: то, ради чего статистику вообще смотрят вовремя, а не
// «когда-нибудь загляну в раздел».
//
// Три вещи, которые нельзя пропустить:
//  1. Всплеск сканеров — сайт активно щупают (и это обычно прелюдия к попытке
//     взлома, а на слабом сервере ещё и нагрузка).
//  2. Сбор посещаемости встал — иначе пустой график читается как «людей нет».
//  3. Посещаемость рухнула — сайт мог быть недоступен снаружи (туннель, DNS,
//     блокировка), при том что изнутри всё «работает».
//
// Канал доставки — существующий журнал ошибок (ErrorLog): он уже даёт красный
// бейдж в меню админки и страницу /admin/errors. Отдельную систему уведомлений
// ради трёх событий заводить незачем.

import { prisma } from "@/lib/db";
import { logError } from "@/lib/errorLog";

export type AnomalyKind = "scanners" | "collector" | "drop";
export type Anomaly = { kind: AnomalyKind; message: string };

/** Сколько сканерских запросов за час считать всплеском. */
const SCANNER_HOUR_LIMIT = 20;
/** Молчание сбора дольше этого — сбор сломан (люди заходят не каждый час, но и не раз в сутки). */
const COLLECTOR_SILENCE_MS = 6 * 3600_000;
/** Ниже какой доли от недельного среднего падение считается обвалом. */
const DROP_RATIO = 0.4;
/** При совсем малой посещаемости «обвал» — это шум, а не сигнал. */
const DROP_MIN_BASELINE = 20;

// Как часто повторять одно и то же оповещение. В памяти процесса: app — один
// долгоживущий контейнер, а после рестарта повтор оповещения не беда.
const REPEAT_MS: Record<AnomalyKind, number> = {
  scanners: 6 * 3600_000,
  collector: 12 * 3600_000,
  drop: 24 * 3600_000,
};
const lastAlertAt = new Map<AnomalyKind, number>();

export function alertsEnabled(): boolean {
  return process.env.ANALYTICS_ALERTS !== "false";
}

/**
 * Найти аномалии.
 * @param scope "fast" — только быстрые проверки (гоняются между делом на приёме
 *              событий), "daily" — плюс сравнение с недельным средним.
 */
export async function detectAnomalies(scope: "fast" | "daily" = "fast", now: Date = new Date()): Promise<Anomaly[]> {
  const out: Anomaly[] = [];

  const hourAgo = new Date(now.getTime() - 3600_000);
  const scanners = await prisma.pageView.count({ where: { botCategory: "scanner", ts: { gte: hourAgo } } });
  if (scanners >= SCANNER_HOUR_LIMIT) {
    const paths = await prisma.pageView.findMany({
      where: { botCategory: "scanner", ts: { gte: hourAgo } },
      select: { path: true },
      distinct: ["path"],
      take: 5,
    });
    out.push({
      kind: "scanners",
      message: `[Трафик] Всплеск сканеров: ${scanners} запросов за час. Примеры путей: ${paths.map((p) => p.path).join(", ")}`,
    });
  }

  const last = await prisma.pageView.findFirst({ orderBy: { ts: "desc" }, select: { ts: true } });
  if (last && now.getTime() - last.ts.getTime() > COLLECTOR_SILENCE_MS) {
    const hours = Math.round((now.getTime() - last.ts.getTime()) / 3600_000);
    out.push({
      kind: "collector",
      message: `[Трафик] Сбор посещаемости молчит ${hours} ч. Проверьте ANALYTICS_ENABLED и доступность /api/analytics/collect`,
    });
  }

  if (scope === "daily") {
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const weekAgo = new Date(now.getTime() - 8 * 86_400_000);
    const [today, prevWeek] = await Promise.all([
      prisma.visitSession.count({ where: { isBot: false, startedAt: { gte: dayAgo } } }),
      prisma.visitSession.count({ where: { isBot: false, startedAt: { gte: weekAgo, lt: dayAgo } } }),
    ]);
    const baseline = prevWeek / 7;
    if (baseline >= DROP_MIN_BASELINE && today < baseline * DROP_RATIO) {
      out.push({
        kind: "drop",
        message: `[Трафик] Посещаемость упала: ${today} визитов за сутки против ${baseline.toFixed(0)} в среднем за неделю. Проверьте, открывается ли сайт снаружи`,
      });
    }
  }

  return out;
}

/** Найти аномалии и записать новые в журнал (с антиспамом по каждому типу). */
export async function runTrafficAlerts(scope: "fast" | "daily" = "fast", now: Date = new Date()): Promise<Anomaly[]> {
  if (!alertsEnabled()) return [];
  const found = await detectAnomalies(scope, now);
  const fresh = found.filter((a) => now.getTime() - (lastAlertAt.get(a.kind) ?? 0) >= REPEAT_MS[a.kind]);
  for (const a of fresh) {
    lastAlertAt.set(a.kind, now.getTime());
    logError(a.message, { path: "/admin/traffic" });
  }
  return fresh;
}

// Быстрые проверки гоняются не по расписанию, а «между делом» — на приёме
// событий, не чаще раза в 15 минут. Так всплеск сканеров виден в течение часа,
// а не на следующие сутки, и при этом не нужен ещё один крон.
const FAST_INTERVAL_MS = 15 * 60_000;
let lastFastRun = 0;

export function maybeRunFastAlerts(now: number = Date.now()): void {
  if (!alertsEnabled()) return;
  if (now - lastFastRun < FAST_INTERVAL_MS) return;
  lastFastRun = now;
  runTrafficAlerts("fast", new Date(now)).catch(() => {
    // проверка оповещений не имеет права ломать приём событий
  });
}
