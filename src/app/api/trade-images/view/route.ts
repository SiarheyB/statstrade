import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { getValidCloudToken } from "@/lib/integrations/cloudStorage";
import { getFreshDownloadHref, YandexDiskError } from "@/lib/integrations/yandexDisk";
import { logError } from "@/lib/errorLog";

// Прокси для просмотра скриншота, загруженного на Яндекс.Диск: у Яндекса нет
// постоянной прямой ссылки на байты файла (в отличие от Google Drive) —
// только короткоживущий подписанный download-URL, который надо перевыпускать
// на каждый показ. imageUrl в БД для yandex_disk указывает СЮДА, а не на
// внешний URL. Доступ — только владельцу сделки (авторизация по сессии,
// как везде), путь к файлу (imageFileId) наружу не отдаём.
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const tradeKey = url.searchParams.get("tradeKey");
  if (!tradeKey || tradeKey.length > 200) return badRequest("Некорректный tradeKey");

  const ann = await prisma.tradeAnnotation.findUnique({
    where: { userId_tradeKey: { userId: user.userId, tradeKey } },
    select: { imageProvider: true, imageFileId: true, imageUrl: true },
  });
  if (!ann?.imageFileId || ann.imageProvider !== "yandex_disk") {
    return badRequest("Изображение не найдено");
  }

  const accessToken = await getValidCloudToken(user.userId, "yandex_disk");
  if (!accessToken) return badRequest("Яндекс.Диск не подключён");

  try {
    const href = await getFreshDownloadHref(accessToken, ann.imageFileId);
    return NextResponse.redirect(href);
  } catch (err) {
    if (err instanceof YandexDiskError) {
      logError(`YandexDisk view failed: ${err.message}`, { path: "/api/trade-images/view" });
      return badRequest("Не удалось открыть изображение");
    }
    return serverError((err as Error).message);
  }
}
