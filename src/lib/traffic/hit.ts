// Сборка события «просмотр страницы» из заголовков запроса.
//
// Модуль обязан оставаться edge-совместимым (без prisma, без node:crypto):
// его вызывает middleware. Запись в БД — отдельно, см. ingest.ts.

import { detectBot, type BotVerdict } from "./bots";
import { parseUa, primaryLang } from "./ua";
import { classifySource, type SourceKind } from "./referrer";
import { normalizePath } from "./paths";

/** Cookie идентификатора посетителя (год) и текущего визита (30 минут). */
export const VISITOR_COOKIE = "ts_vid";
export const SESSION_COOKIE = "ts_sid";
export const VISITOR_MAX_AGE = 365 * 24 * 3600;
/** Визит считается законченным после 30 минут без запросов — как в GA/Plausible. */
export const SESSION_MAX_AGE = 30 * 60;

export type TrafficHit = {
  path: string;
  visitorId: string;
  sessionId: string;
  isBot: boolean;
  botName: string | null;
  botCategory: string | null;
  botReason: string | null;
  source: SourceKind;
  refHost: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  device: string;
  browser: string | null;
  os: string | null;
  lang: string | null;
  country: string | null;
  authed: boolean;
  userId: string | null;
  userAgent: string | null;
  /** "load" — полная загрузка страницы, "spa" — переход внутри приложения. */
  nav: "load" | "spa";
  /** Проставляет браузерный маячок: JS выполнился, это точно не простой скрипт. */
  js?: boolean;
  screen?: string | null;
};

// Соль для анонимизации IP. Отдельная переменная не обязательна: если её нет,
// берём JWT_SECRET — он всё равно есть на любом стенде. Сырой IP не хранится
// нигде, только необратимый хэш; поэтому в статистике нет персональных данных.
function salt(): string {
  return process.env.ANALYTICS_SALT || process.env.JWT_SECRET || "tradestats-analytics";
}

const encoder = new TextEncoder();

/** SHA-256 → первые 16 hex-символов. Достаточно для группировки, необратимо. */
export async function shortHash(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  const bytes = new Uint8Array(buf).slice(0, 8);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** IP клиента из заголовков прокси (nginx/Cloudflare/туннель). */
export function clientIpFromHeaders(h: Headers): string {
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return h.get("x-real-ip")?.trim() || "unknown";
}

export type BuildHitInput = {
  url: URL;
  headers: Headers;
  /** Значения cookie ts_vid / ts_sid, если браузер их вернул. */
  visitorCookie?: string | null;
  sessionCookie?: string | null;
  authed?: boolean;
  userId?: string | null;
  nav?: "load" | "spa";
  now?: Date;
  /** Referer/юзер-агент можно передать явно — так делает браузерный маячок. */
  refererOverride?: string | null;
};

export type BuiltHit = {
  hit: TrafficHit;
  /** Ставить ли cookie: их выдаём только на просмотрах страниц. */
  visitorId: string;
  sessionId: string;
  bot: BotVerdict;
};

/**
 * Событие просмотра + идентификаторы посетителя и визита.
 *
 * Идентификаторы: сначала cookie, а если её нет — детерминированный хэш
 * (IP + User-Agent + соль + сутки). Так у роботов, которые cookie не хранят,
 * все запросы всё равно склеиваются в одного «посетителя», а не порождают
 * тысячу уникальных. Хэш посуточный: возвращаемость по нему не отследить —
 * это осознанный размен в пользу приватности.
 */
export async function buildHit(input: BuildHitInput): Promise<BuiltHit> {
  const { url, headers } = input;
  const now = input.now ?? new Date();
  const ua = headers.get("user-agent");
  const path = normalizePath(url.pathname);

  const bot = detectBot({
    userAgent: ua,
    acceptLanguage: headers.get("accept-language"),
    secFetchMode: headers.get("sec-fetch-mode"),
    path: url.pathname,
  });

  const ipHash = await shortHash(`${clientIpFromHeaders(headers)}|${ua ?? ""}|${salt()}`);
  const dayKey = now.toISOString().slice(0, 10);
  const halfHour = Math.floor(now.getTime() / (SESSION_MAX_AGE * 1000));

  const visitorId = input.visitorCookie || `h${await shortHash(`${ipHash}|${dayKey}`)}`;
  const sessionId = input.sessionCookie || `s${await shortHash(`${ipHash}|${halfHour}`)}`;

  const src = classifySource(
    input.refererOverride ?? headers.get("referer"),
    url.searchParams,
    headers.get("host"),
  );
  const uaInfo = parseUa(ua, bot.isBot);

  return {
    visitorId,
    sessionId,
    bot,
    hit: {
      path,
      visitorId,
      sessionId,
      isBot: bot.isBot,
      botName: bot.name,
      botCategory: bot.category,
      botReason: bot.reason,
      source: src.source,
      refHost: src.refHost,
      referrer: src.referrer,
      utmSource: src.utmSource,
      utmMedium: src.utmMedium,
      utmCampaign: src.utmCampaign,
      device: uaInfo.device,
      browser: uaInfo.browser,
      os: uaInfo.os,
      lang: primaryLang(headers.get("accept-language")),
      country: headers.get("cf-ipcountry") || headers.get("x-vercel-ip-country") || null,
      authed: input.authed ?? false,
      userId: input.userId ?? null,
      userAgent: ua ? ua.slice(0, 400) : null,
      nav: input.nav ?? "load",
    },
  };
}
