// Разбор User-Agent на устройство / браузер / ОС.
//
// Без внешней библиотеки (ua-parser-js тянет ~200 КБ и обновляемые базы): для
// вопроса «с телефона или с компьютера, какой браузер» достаточно десятка
// регулярок. Модуль чистый — работает и в edge-рантайме middleware.

export type DeviceKind = "desktop" | "mobile" | "tablet" | "bot" | "unknown";

export type UaInfo = {
  device: DeviceKind;
  browser: string | null;
  os: string | null;
};

const BROWSERS: { re: RegExp; name: string }[] = [
  // Порядок важен: Edge/Opera/Yandex тоже содержат "Chrome" в UA.
  { re: /edg(?:e|ios|a)?\//, name: "Edge" },
  { re: /opr\/|opera/, name: "Opera" },
  { re: /yabrowser/, name: "Yandex Browser" },
  { re: /vivaldi/, name: "Vivaldi" },
  { re: /brave/, name: "Brave" },
  { re: /samsungbrowser/, name: "Samsung Internet" },
  { re: /firefox|fxios/, name: "Firefox" },
  { re: /chrome|crios|chromium/, name: "Chrome" },
  { re: /safari/, name: "Safari" },
  { re: /msie |trident\//, name: "Internet Explorer" },
];

const OSES: { re: RegExp; name: string }[] = [
  { re: /windows nt 10|windows nt 11/, name: "Windows 10/11" },
  { re: /windows/, name: "Windows" },
  { re: /iphone|ipad|ipod|ios /, name: "iOS" },
  { re: /mac os x|macintosh/, name: "macOS" },
  { re: /android/, name: "Android" },
  { re: /cros/, name: "ChromeOS" },
  { re: /ubuntu|debian|fedora|linux/, name: "Linux" },
];

export function parseUa(userAgent: string | null | undefined, isBot = false): UaInfo {
  const ua = (userAgent ?? "").toLowerCase();
  if (isBot) return { device: "bot", browser: null, os: osOf(ua) };
  if (!ua) return { device: "unknown", browser: null, os: null };

  const tablet = /ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua);
  const mobile = /iphone|ipod|android.*mobile|windows phone|mobile safari|opera mini|iemobile/.test(ua);
  const device: DeviceKind = tablet ? "tablet" : mobile ? "mobile" : "desktop";

  return { device, browser: browserOf(ua), os: osOf(ua) };
}

function browserOf(ua: string): string | null {
  for (const b of BROWSERS) if (b.re.test(ua)) return b.name;
  return null;
}

function osOf(ua: string): string | null {
  for (const o of OSES) if (o.re.test(ua)) return o.name;
  return null;
}

/** Основной язык из Accept-Language: "ru-RU,ru;q=0.9,en;q=0.8" → "ru". */
export function primaryLang(acceptLanguage: string | null | undefined): string | null {
  if (!acceptLanguage) return null;
  const first = acceptLanguage.split(",")[0]?.trim();
  if (!first) return null;
  const code = first.split(";")[0].trim().split("-")[0].toLowerCase();
  return /^[a-z]{2,3}$/.test(code) ? code : null;
}
