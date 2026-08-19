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
  // Локальная разработка ходит по http, наружу — всегда https (HSTS в
  // next.config.ts), поэтому доверяем заголовку прокси, а не гадаем.
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
