// Публичный адрес сайта — для robots.txt, sitemap.xml и прочего, где нужен
// абсолютный URL.
//
// Отдельной обязательной переменной окружения намеренно нет: приложение живёт
// за туннелем (Tailscale Funnel / Cloudflare), домен там меняется без пересборки
// образа. Поэтому по умолчанию берём хост из заголовков запроса — прокси
// проставляет x-forwarded-host/proto, — а SITE_URL нужен только если хочется
// зафиксировать канонический адрес явно.

import { headers } from "next/headers";

/**
 * Похоже ли это на имя хоста (с необязательным портом).
 *
 * Намеренно узко: буквы, цифры, точка, дефис и `:порт`. Ни кавычек, ни
 * угловых скобок, ни пробелов, ни слэшей — то есть ничего, чем можно выйти
 * за пределы значения при вставке в URL или в JSON внутри <script>.
 */
export function isHostname(value: string): boolean {
  if (!value || value.length > 253) return false;
  return /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?(:\d{1,5})?$/.test(value);
}

export async function siteUrl(): Promise<string> {
  const env = process.env.SITE_URL?.trim();
  if (env) return env.replace(/\/$/, "");

  const h = await headers();
  // Хост приходит из заголовка, то есть от клиента: nginx передаёт `Host` как
  // есть, а `x-forwarded-host` не переписывает вовсе. Отсюда он попадает в
  // robots.txt, sitemap.xml и в JSON-LD на КАЖДОЙ странице — а JSON.stringify
  // не экранирует "<", так что значение вида `a"}</script><script>…`
  // разрывало бы тег (CSP это не ловит: в script-src стоит 'unsafe-inline').
  // Браузер такой заголовок сам не пошлёт, но промежуточный кэш превращает это
  // в отравление страницы для всех, а поисковику подсовывает чужой домен.
  //
  // Поэтому: только то, что вообще может быть именем хоста. Всё остальное —
  // на дефолт, как будто заголовка не было.
  const raw = h.get("x-forwarded-host") || h.get("host") || "";
  const host = isHostname(raw) ? raw : "localhost:3000";
  // Наружу сайт живёт только по HTTPS (HSTS в next.config.ts), поэтому
  // заголовку прокси здесь доверять нельзя: Cloudflare в режиме Flexible
  // ходит к origin по HTTP и проставляет x-forwarded-proto: http. Из-за этого
  // robots.txt и sitemap.xml отдавали ссылки вида http://tradingstat.ru/ —
  // поисковик получал карту сайта, каждый URL которой ведёт на редирект.
  // Локальная разработка — единственное место, где протокол http.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  return `${local ? "http" : "https"}://${host}`;
}
