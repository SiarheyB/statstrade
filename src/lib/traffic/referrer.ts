// Откуда пришёл посетитель: разбор Referer + UTM-меток.
//
// Важная особенность, которую легко забыть: браузеры по умолчанию шлют
// кросс-доменный Referer урезанным до origin (strict-origin-when-cross-origin),
// поэтому «страница-источник» почти всегда недоступна — известен только хост.
// Отсюда и модель данных: refHost + категория, а не полный URL.
//
// Модуль чистый — используется в middleware (edge) и в тестах.

export type SourceKind =
  | "direct" // без Referer: закладка, ввод адреса, переход из мессенджера без метки
  | "search" // поисковая выдача
  | "social" // соцсети и мессенджеры
  | "referral" // ссылка с другого сайта
  | "campaign" // есть utm_source / ?ref= — приоритетнее Referer
  | "internal"; // переход внутри самого сайта

const SEARCH = /^(www\.)?(google\.|yandex\.|bing\.|duckduckgo\.|search\.|baidu\.|ecosia\.|brave\.com|startpage\.|mail\.ru|rambler\.|ya\.ru|qwant\.)/i;
const SOCIAL =
  /^(www\.)?(t\.me|telegram\.|vk\.com|vk\.ru|m\.vk\.com|facebook\.|fb\.me|instagram\.|twitter\.com|x\.com|t\.co|linkedin\.|lnkd\.in|reddit\.|youtube\.|youtu\.be|tiktok\.|pinterest\.|ok\.ru|dzen\.ru|zen\.yandex\.|discord\.|whatsapp\.|threads\.)/i;

export type SourceInfo = {
  source: SourceKind;
  /** Нормализованный хост источника (или значение utm_source). */
  refHost: string | null;
  /** Полный Referer, усечённый — на случай, если источник его всё же прислал. */
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function clean(v: string | null | undefined, max = 80): string | null {
  if (!v) return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

/**
 * Категория источника.
 *
 * @param referer   заголовок Referer (или document.referrer от маячка)
 * @param params    query-строка запроса — utm_source/medium/campaign, ref
 * @param selfHost  хост самого приложения: свои же ссылки — internal
 */
export function classifySource(
  referer: string | null | undefined,
  params: URLSearchParams | null | undefined,
  selfHost: string | null | undefined,
): SourceInfo {
  const utmSource = clean(params?.get("utm_source") ?? params?.get("ref"));
  const utmMedium = clean(params?.get("utm_medium"));
  const utmCampaign = clean(params?.get("utm_campaign"));
  const refHostRaw = hostOf(referer);
  const referrerStr = clean(referer, 300);
  const self = (selfHost ?? "").toLowerCase().replace(/^www\./, "").split(":")[0];

  // UTM-метка перебивает Referer: ссылку из Telegram/письма браузер часто
  // отдаёт вообще без Referer, и только метка говорит, что это была кампания.
  if (utmSource) {
    return {
      source: "campaign",
      refHost: utmSource.toLowerCase(),
      referrer: referrerStr,
      utmSource,
      utmMedium,
      utmCampaign,
    };
  }

  if (!refHostRaw) {
    return { source: "direct", refHost: null, referrer: null, utmSource: null, utmMedium: null, utmCampaign: null };
  }

  const base = { refHost: refHostRaw, referrer: referrerStr, utmSource: null, utmMedium: null, utmCampaign: null };
  if (self && (refHostRaw === self || refHostRaw.endsWith(`.${self}`))) return { source: "internal", ...base };
  if (SEARCH.test(refHostRaw)) return { source: "search", ...base };
  if (SOCIAL.test(refHostRaw)) return { source: "social", ...base };
  return { source: "referral", ...base };
}
