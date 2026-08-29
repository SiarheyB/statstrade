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

/**
 * Можно ли ходить по этому адресу.
 *
 * URL приходит из ЧУЖОГО RSS-фида, а качаем мы его с сервера — то есть изнутри
 * сети, где живут коллектор (:8080), форекс-коллектор (:8081), Postgres и сам
 * app. Фид, который подставит `http://collector:8080/metrics` или
 * `http://169.254.169.254/`, заставит сервер сходить туда за нас. Ответ наружу
 * не отдаётся (его жуёт sharp и давится), но прощупать внутренние порты и
 * дёрнуть внутренние URL этого достаточно.
 *
 * Поэтому: только https и только публичные адреса. Обложки новостей лежат на
 * CDN, других вариантов у них не бывает.
 */
export function isSafeCoverUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false;

  // IPv6 — только если это ДЕЙСТВИТЕЛЬНО адрес, а не имя. Проверять префиксы
  // на любой строке нельзя: "fcdn.example.com" и "fd-media.example.com" —
  // обычные домены CDN, а начинаются с fc/fd (диапазон ULA).
  if (host.includes(":")) {
    if (host === "::1") return false;
    if (/^fe80:/.test(host)) return false;      // link-local
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return false; // ULA fc00::/7
    return true;
  }

  // IPv4: петля, приватные сети, link-local (включая метаданные облака) и
  // CGNAT 100.64/10 — именно в нём живёт tailnet этого развёртывания.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10, Tailscale
  }
  // Имя без точки — это имя сервиса в compose-сети (db, collector, app).
  if (!host.includes(".")) return false;
  return true;
}

async function downloadCover(url: string): Promise<Buffer | null> {
  if (!isSafeCoverUrl(url)) return null;
  const res = await fetch(url, {
    // Редирект — обход проверки выше: CDN мог бы увести на внутренний адрес.
    // Обложки лежат по прямой ссылке, гоняться за переадресацией незачем.
    redirect: "error",
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
