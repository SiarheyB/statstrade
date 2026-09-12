import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/crypto";
import { runLevelAlerts } from "@/lib/recommendations/alertRunner";
import { runEconcalPush } from "@/lib/econcalPushRunner";

export const maxDuration = 60;

/**
 * Минутный такт всех push-уведомлений приложения:
 *
 *  • «цена подошла к уровню» — подписки со страницы «Рекомендации»;
 *  • «скоро выходит новость» — напоминания экономического календаря
 *    для тех устройств, где вкладка закрыта.
 *
 * Оба прохода в одном эндпоинте намеренно: такт у них общий (минута), и одна
 * строка в crontab честнее двух, которые всё равно всегда включают вместе.
 *
 * Раз в минуту — это не опечатка и почти ничего не стоит. Проверка уровней
 * делает ОДИН запрос к Binance за ценами всех контрактов сразу (а при нуле
 * подписок не делает и его), напоминания календаря читают уже лежащие в БД
 * события. Реже нельзя по сути задачи: уровень — это цена, у которой сделка
 * либо случается, либо нет, а «напомнить за 5 минут» с точностью в 5 минут не
 * напоминание.
 *
 * Крон хоста, а не внутренний планировщик: /api/cron/* — общий приём проекта
 * (тот же секрет, что у /api/cron/sync и /api/cron/recommendations, см.
 * docs/SELF_HOSTING.md).
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return secretEquals(req.headers.get("authorization"), `Bearer ${secret}`);
}

async function handle(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET не задан" }, { status: 500 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  // Независимо друг от друга: упавший календарь не должен отменять проверку
  // уровней и наоборот. allSettled, а не Promise.all, ровно поэтому.
  const [levels, econcal] = await Promise.allSettled([runLevelAlerts(), runEconcalPush()]);

  // Отметку в CronHeartbeat здесь НЕ ставим: задача дёргается раз в минуту, и
  // запись на каждый проход — 1440 обновлений в сутки ради строки, на которую
  // смотрят раз в неделю.
  return NextResponse.json({
    ok: levels.status === "fulfilled" && econcal.status === "fulfilled",
    levels: levels.status === "fulfilled" ? levels.value : { error: String(levels.reason) },
    econcal: econcal.status === "fulfilled" ? econcal.value : { error: String(econcal.reason) },
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
