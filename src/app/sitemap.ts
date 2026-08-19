import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { siteUrl } from "@/lib/siteUrl";

// sitemap.xml — список публичных страниц для поисковиков.
//
// Страницы за логином и /share/<токен> сюда не попадают по той же причине, что
// и в robots.txt. Лента новостей меняется каждый час, поэтому lastModified у
// неё берём из самой свежей записи, а не ставим "сейчас": поисковику важно
// отличать реально обновившуюся страницу от постоянно «свежей».
// Динамический: адрес сайта берётся из заголовков запроса (см. lib/siteUrl.ts),
// а значит закэшировать карту на сборке нельзя. Запрос к БД тут один и лёгкий.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await siteUrl();

  let newsUpdated = new Date();
  try {
    const latest = await prisma.newsItem.findFirst({
      orderBy: { publishedAt: "desc" },
      select: { publishedAt: true },
    });
    if (latest?.publishedAt) newsUpdated = latest.publishedAt;
  } catch {
    // БД недоступна — отдаём карту с текущей датой, это лучше, чем 500 роботу
  }

  return [
    { url: `${base}/`, lastModified: newsUpdated, changeFrequency: "daily", priority: 1 },
    { url: `${base}/news`, lastModified: newsUpdated, changeFrequency: "hourly", priority: 0.8 },
    { url: `${base}/calendar`, lastModified: new Date(), changeFrequency: "daily", priority: 0.7 },
  ];
}
