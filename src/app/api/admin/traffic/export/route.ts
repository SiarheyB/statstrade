// Выгрузка статистики посещаемости в CSV.
//
// Зачем: раздел в админке отвечает на вопросы «как сейчас», а сравнивать
// «до и после публикации в канале», строить свои графики и хранить историю
// отдельно от сервера удобнее в таблице.

import { requireAdmin } from "@/lib/admin";
import { getBots, getRecentVisits, getSeries, getSources, getTopPages, type Audience, type TrafficRange } from "@/lib/traffic/query";
import { isPeriod, periodBounds, type PeriodKey } from "@/lib/traffic/periods";
import { csvFileName, toCsv } from "@/lib/traffic/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WHATS = ["days", "pages", "sources", "bots", "visits"] as const;
type What = (typeof WHATS)[number];

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const what = (WHATS as readonly string[]).includes(url.searchParams.get("what") ?? "")
    ? (url.searchParams.get("what") as What)
    : "days";
  const period: PeriodKey = isPeriod(url.searchParams.get("p")) ? (url.searchParams.get("p") as PeriodKey) : "30d";
  const audience = (["human", "bot", "all"] as const).includes(url.searchParams.get("a") as Audience)
    ? (url.searchParams.get("a") as Audience)
    : "human";
  const tzOffsetMin = Number(url.searchParams.get("tz")) || 0;

  const b = periodBounds(period, new Date(), tzOffsetMin);
  const range: TrafficRange = { ...b, tzOffsetMin, audience };

  // Лимиты выше, чем на экране: выгрузка — как раз для «посмотреть весь хвост».
  const csv = await build(what, range);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${csvFileName(what, period)}"`,
      "cache-control": "no-store",
    },
  });
}

async function build(what: What, range: TrafficRange): Promise<string> {
  switch (what) {
    case "days": {
      const rows = await getSeries(range);
      return toCsv(
        ["Период", "Просмотры (люди)", "Посетители (люди)", "Просмотры (роботы)"],
        rows.map((r) => [r.bucket.slice(0, 16).replace("T", " "), r.humanViews, r.humanVisitors, r.botViews]),
      );
    }
    case "pages": {
      const rows = await getTopPages(range, 500);
      return toCsv(
        ["Страница", "Просмотры", "Посетители", "Входы", "Отказы, %"],
        rows.map((r) => [r.path, r.views, r.visitors, r.entries, (r.bounceRate * 100).toFixed(1)]),
      );
    }
    case "sources": {
      const rows = await getSources(range, 500);
      return toCsv(
        ["Тип источника", "Источник", "Визиты", "Посетители", "Отказы, %", "Регистрации"],
        rows.map((r) => [r.source, r.refHost ?? "", r.sessions, r.visitors, (r.bounceRate * 100).toFixed(1), r.registered]),
      );
    }
    case "bots": {
      const rows = await getBots(range, 500);
      return toCsv(
        ["Робот", "Категория", "Просмотры", "Визиты", "Последний раз", "Последняя страница"],
        rows.map((r) => [r.name, r.category ?? "", r.views, r.sessions, r.lastSeen.slice(0, 19).replace("T", " "), r.topPath ?? ""]),
      );
    }
    case "visits": {
      const rows = await getRecentVisits(range, 2000);
      return toCsv(
        ["Начало", "Конец", "Просмотры", "Вход", "Выход", "Тип источника", "Источник", "Устройство", "Браузер", "ОС", "Страна", "Язык", "Робот", "JS", "Регистрация", "Вход в аккаунт"],
        rows.map((r) => [
          r.startedAt.slice(0, 19).replace("T", " "),
          r.lastSeenAt.slice(0, 19).replace("T", " "),
          r.views, r.entryPath, r.exitPath, r.source, r.refHost ?? "",
          r.device, r.browser ?? "", r.os ?? "", r.country ?? "", r.lang ?? "",
          r.isBot ? (r.botName ?? "да") : "нет",
          r.jsConfirmed ? "да" : "нет",
          r.registered ? "да" : "нет",
          r.loggedIn ? "да" : "нет",
        ]),
      );
    }
  }
}
