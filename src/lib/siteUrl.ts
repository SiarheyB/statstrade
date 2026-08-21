// Публичный адрес сайта — для robots.txt, sitemap.xml и прочего, где нужен
// абсолютный URL.
//
// Отдельной обязательной переменной окружения намеренно нет: приложение живёт
// за туннелем (Tailscale Funnel / Cloudflare), домен там меняется без пересборки
// образа. Поэтому по умолчанию берём хост из заголовков запроса — прокси
// проставляет x-forwarded-host/proto, — а SITE_URL нужен только если хочется
// зафиксировать канонический адрес явно.

import { headers } from "next/headers";

export async function siteUrl(): Promise<string> {
  const env = process.env.SITE_URL?.trim();
  if (env) return env.replace(/\/$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  // Наружу сайт живёт только по HTTPS (HSTS в next.config.ts), поэтому
  // заголовку прокси здесь доверять нельзя: Cloudflare в режиме Flexible
  // ходит к origin по HTTP и проставляет x-forwarded-proto: http. Из-за этого
  // robots.txt и sitemap.xml отдавали ссылки вида http://tradingstat.ru/ —
  // поисковик получал карту сайта, каждый URL которой ведёт на редирект.
  // Локальная разработка — единственное место, где протокол http.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  return `${local ? "http" : "https"}://${host}`;
}
