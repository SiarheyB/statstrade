/**
 * newsImages.ts — обложки новостей, сохранённые у нас.
 *
 * Зачем: источники отдают картинку в исходном размере и со своего CDN. Замер
 * на проде: обложка Cointelegraph — 1.5 МБ и 16.7 секунды, при том что
 * показывается она плашкой 80–112 px. Это была самая тяжёлая часть главной.
 *
 * Что делаем: один раз скачиваем, ужимаем в webp шириной COVER_WIDTH (те же
 * полтора мегабайта превращаются в 15–25 КБ) и кладём в NewsImage. Дальше
 * страница берёт её у нас (/api/news/image/[id]) — быстро и предсказуемо.
 *
 * Чего НЕ делаем: не ретраим и не караулим. Не скачалось — новость просто
 * остаётся со ссылкой на внешний CDN, как было раньше, а следующий обход фидов
 * попробует снова. Обложка не тот повод, чтобы задерживать ленту.
 */

import sharp from "sharp";
import { prisma } from "./db";

/** Ширина сохранённой обложки. Показываем максимум 112 px, ×2 для retina. */
const COVER_WIDTH = 320;
/** Сколько обложек забираем за один обход фидов. */
const BATCH = 12;
/** Сколько качаем одновременно: слабому серверу хватает трёх. */
const CONCURRENCY = 3;
/** Источник, не отдавший картинку за это время, ждёт следующего обхода. */
const FETCH_TIMEOUT_MS = 20_000;
/**
 * Потолок на исходник. Полтора мегабайта — это ещё обложка, а вот десять уже
 * означают, что по ссылке лежит не то, что мы думаем: тянуть такое в память
 * ради плашки 112 px незачем.
 */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

/** Ссылка, по которой страница берёт обложку у нас. */
export function newsImageSrc(newsId: string): string {
  return `/api/news/image/${newsId}`;
}

/**
 * Подменяет imageUrl на нашу ссылку у тех новостей, чья обложка уже сохранена.
 *
 * Так вызывающий код (главная, лента) не меняется вовсе: он по-прежнему читает
 * `imageUrl`, просто теперь там чаще стоит наш адрес. У новостей, которые ещё
 * не успели скачаться, остаётся внешний CDN — картинка есть всегда.
 */
export async function withLocalCovers<T extends { id: string; imageUrl: string | null }>(
  items: T[],
): Promise<T[]> {
  const ids = items.filter((i) => i.imageUrl).map((i) => i.id);
  if (ids.length === 0) return items;
  const saved = await prisma.newsImage.findMany({
    where: { newsId: { in: ids } },
    select: { newsId: true },
  });
  if (saved.length === 0) return items;
  const has = new Set(saved.map((s) => s.newsId));
  return items.map((i) => (has.has(i.id) ? { ...i, imageUrl: newsImageSrc(i.id) } : i));
}

async function downloadCover(url: string): Promise<Buffer | null> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    // Часть CDN отдаёт 403 без внятного UA — тот же приём, что у обхода фидов.
    headers: { "user-agent": "Mozilla/5.0 (compatible; TradeStatsBot/1.0)" },
  });
  if (!res.ok) return null;
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_SOURCE_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.byteLength > MAX_SOURCE_BYTES ? null : buf;
}

/** Скачать и сохранить одну обложку. `false` — не вышло, попробуем позже. */
async function cacheOne(newsId: string, url: string): Promise<boolean> {
  try {
    const raw = await downloadCover(url);
    if (!raw) return false;
    const data = await sharp(raw)
      // withoutEnlargement: маленькую картинку не растягиваем — незачем.
      .resize({ width: COVER_WIDTH, withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();
    await prisma.newsImage.upsert({
      where: { newsId },
      create: { newsId, data, width: COVER_WIDTH, bytes: data.byteLength },
      update: { data, width: COVER_WIDTH, bytes: data.byteLength },
    });
    return true;
  } catch {
    // Битый файл, недоступный хост, формат не по зубам sharp — не наша беда.
    return false;
  }
}

/**
 * Забрать обложки у новостей, которые их ещё не получили.
 *
 * Вызывается после обхода фидов. Берём порцию, а не всё сразу: на первом
 * запуске новостей в базе сотни, и качать их разом означает занять сеть и
 * память на минуты.
 */
export async function cacheMissingCovers(limit = BATCH): Promise<{ saved: number; failed: number }> {
  const pending = await prisma.newsItem.findMany({
    where: { imageUrl: { not: null }, image: null },
    orderBy: { publishedAt: "desc" }, // свежие важнее: их и показывают
    take: limit,
    select: { id: true, imageUrl: true },
  });
  if (pending.length === 0) return { saved: 0, failed: 0 };

  let saved = 0;
  let failed = 0;
  const queue = [...pending];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      if (await cacheOne(item.id, item.imageUrl!)) saved++;
      else failed++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return { saved, failed };
}
