import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";

// robots.txt. Раньше файла не было вовсе — поисковик обходил сайт как придётся,
// включая приватные разделы, а карты сайта не видел.
//
// Закрываем всё, что не имеет смысла в поиске: личный кабинет, админку, API и
// (важно!) публичные ссылки /share/<токен> — сам токен является ключом доступа,
// в индексе ему не место.
//
// AI-краулеры (GPTBot, ClaudeBot, CCBot и т.п.) НЕ блокируются: они приводят
// упоминания и переходы. Кто ходит и как часто — видно в /admin/traffic,
// раздел «Роботы»; если конкретный краулер начнёт мешать, добавьте его сюда
// отдельным правилом с `disallow: "/"`.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard/", "/admin/", "/api/", "/share/", "/login", "/register"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
