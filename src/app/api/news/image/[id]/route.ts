import { prisma } from "@/lib/db";

/**
 * Обложка новости, сохранённая у нас (см. lib/newsImages.ts).
 *
 * БЕЗ авторизации намеренно: главная и лента новостей публичные, гость должен
 * видеть картинки. Ничего приватного тут нет — это обложка чужой статьи,
 * ужатая до 320 px.
 *
 * Кэш на год и immutable: обложка привязана к вышедшей статье и не меняется
 * никогда, а id новости стабилен. Браузер после первого раза не переспрашивает.
 */
const CACHE = "public, max-age=31536000, immutable";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const image = await prisma.newsImage.findUnique({
    where: { newsId: id },
    select: { data: true, mime: true },
  });
  if (!image) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mime,
      "Content-Length": String(image.data.byteLength),
      "Cache-Control": CACHE,
    },
  });
}
