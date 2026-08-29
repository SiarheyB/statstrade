// Сборка события «просмотр страницы» из заголовков запроса.
//
// Модуль обязан оставаться edge-совместимым (без prisma, без node:crypto):
// его вызывает middleware. Запись в БД — отдельно, см. ingest.ts.

import { clientIpFromHeaders } from "@/lib/clientIp";
import { detectBot, type BotVerdict } from "./bots";
import { parseUa, primaryLang } from "./ua";
import { classifySource, type SourceKind } from "./referrer";
import { normalizePath } from "./paths";

/**
 * Режим без cookie. По умолчанию счётчик ставит две технические cookie
 * (посетитель + визит) — без них не отличить «10 заходов одного человека» от
 * «10 разных людей» дольше суток.
 *
 * ANALYTICS_COOKIES=false переводит сбор в полностью бескуковый режим: никакие
 * cookie не ставятся и не читаются, идентификатор считается как хэш IP+UA с
 * солью и живёт ровно сутки. Возвращаемость при этом не отслеживается — зато
 * не нужен баннер согласия (в ЕС первая же аналитическая cookie формально
 * требует согласия пользователя).
 */
export function cookiesEnabled(): boolean {
  return process.env.ANALYTICS_COOKIES !== "false";
}

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

// Заголовки, в которых прокси/CDN сообщает страну посетителя. Сам сервер
// определить её не может (GeoIP-базы в приложении нет и не будет — это
// десятки мегабайт, которые надо ещё и обновлять), поэтому страна появляется
// в статистике, только если трафик идёт через Cloudflare или другой CDN,
// проставляющий такой заголовок. Без него колонка просто пустая, см.
// docs/SELF_HOSTING.md.
const COUNTRY_HEADERS = [
  "cf-ipcountry", // Cloudflare (в т.ч. бесплатный тариф)
  "x-vercel-ip-country",
  "x-geo-country",
  "x-country-code",
  "x-appengine-country",
  "fastly-client-country",
];

// Заглушки, которыми CDN отвечает, когда страну определить не удалось:
// XX — неизвестно, T1 — выход из Tor, ZZ/A1/A2 — анонимайзеры и спутник.
const UNKNOWN_COUNTRIES = new Set(["XX", "T1", "ZZ", "A1", "A2", "AP", "EU"]);

/** Двухбуквенный код страны из заголовков CDN, либо null. */
export function countryFromHeaders(h: Headers): string | null {
  for (const name of COUNTRY_HEADERS) {
    const raw = h.get(name);
    if (!raw) continue;
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || UNKNOWN_COUNTRIES.has(code)) continue;
    return code;
  }
  return null;
}

/**
 * IP клиента из заголовков прокси — общая реализация, см. lib/clientIp.ts
 * (там разобрано, почему первому элементу x-forwarded-for и заголовку
 * cf-connecting-ip доверять нельзя).
 *
 * Здесь это важно не меньше: из IP считается visitorId, а по нему работает
 * защита от заливки таблицы просмотров (floodCheck). Подделываемый IP означал
 * новый «посетитель» на каждый запрос и обход этой защиты.
 *
 * Реэкспорт, а не своя копия: две копии этой функции уже расходились.
 */
export { clientIpFromHeaders };

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

  // В бескуковом режиме присланные cookie игнорируем целиком: иначе после
  // выключения режима старые значения продолжали бы «узнавать» посетителей.
  const withCookies = cookiesEnabled();
  const visitorId = (withCookies && input.visitorCookie) || `h${await shortHash(`${ipHash}|${dayKey}`)}`;
  const sessionId = (withCookies && input.sessionCookie) || `s${await shortHash(`${ipHash}|${halfHour}`)}`;

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
      country: countryFromHeaders(headers),
      authed: input.authed ?? false,
      userId: input.userId ?? null,
      userAgent: ua ? ua.slice(0, 400) : null,
      nav: input.nav ?? "load",
    },
  };
}
