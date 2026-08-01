import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { bumpStatsVersion } from "@/lib/statsCache";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { detectImageType, isAllowedImageType, extForMime, MAX_IMAGE_BYTES } from "@/lib/imageValidation";
import { getValidCloudToken, firstConnectedProvider } from "@/lib/integrations/cloudStorage";
import { uploadImage, makeFilePublic, directImageUrl, getOrCreateAppFolder, GoogleDriveError } from "@/lib/integrations/googleDrive";
import { uploadFile, publishResource, YandexDiskError } from "@/lib/integrations/yandexDisk";
import { logError } from "@/lib/errorLog";

// Скриншоты кладём в отдельную папку, а не в корень "Мой диск"/"Приложения"
// пользователя — так их легко найти и они не мешаются среди остальных файлов.
// Для Яндекс.Диска подпапка того же имени зашита в lib/integrations/yandexDisk.ts
// (DEAL_FOLDER) — там своя структура путей, но имя то же самое сознательно.
const DEAL_FOLDER_NAME = "tradingstat_deal";

// Загружает скриншот сделки в облако пользователя (Google Drive или
// Яндекс.Диск — НЕ на наш сервер) и сохраняет только ссылку в
// TradeAnnotation. Файл никогда не проходит через постоянное хранилище
// приложения — читаем его целиком в память (лимит 10 МБ), проверяем и сразу
// пересылаем в API провайдера.
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  // Лимит защищает квоту API провайдера и наш сервер от заливки спама.
  const limit = rateLimit(`trade-image-upload:${clientIp(req)}:${user.userId}`, 20, 10 * 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Слишком много загрузок, попробуйте позже" }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Ожидается multipart/form-data запрос");
  }

  const tradeKey = form.get("tradeKey");
  const file = form.get("file");
  if (typeof tradeKey !== "string" || !tradeKey.trim() || tradeKey.length > 200) {
    return badRequest("Некорректный tradeKey");
  }
  if (!(file instanceof File)) {
    return badRequest("Файл не найден в запросе");
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return badRequest(`Файл слишком большой (максимум ${MAX_IMAGE_BYTES / (1024 * 1024)} МБ)`);
  }

  const provider = await firstConnectedProvider(user.userId);
  if (!provider) {
    return badRequest("Облачное хранилище не подключено — подключите его в настройках");
  }
  const accessToken = await getValidCloudToken(user.userId, provider);
  if (!accessToken) {
    return badRequest("Облачное хранилище не подключено — подключите его в настройках");
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // Реальный тип определяем по сигнатуре файла, а не по Content-Type от
  // клиента (тот легко подделать) — отсекаем не-изображения (в т.ч. HTML/SVG
  // со скриптами, замаскированные под картинку).
  const detected = detectImageType(buf);
  if (!detected || !isAllowedImageType(detected)) {
    return badRequest("Файл не распознан как изображение (поддерживаются PNG, JPEG, WEBP, GIF)");
  }

  const filename = `tradestats_${tradeKey.replace(/[^a-zA-Z0-9_-]/g, "_")}.${extForMime(detected)}`;

  try {
    let imageUrl: string;
    let imageFileId: string;

    if (provider === "google_drive") {
      const folderId = await getOrCreateAppFolder(accessToken, DEAL_FOLDER_NAME);
      const { id: fileId } = await uploadImage(accessToken, filename, detected, buf, folderId);
      await makeFilePublic(accessToken, fileId);
      imageUrl = directImageUrl(fileId);
      imageFileId = fileId;
    } else {
      // Яндекс.Диск не даёт постоянной прямой ссылки на байты файла — только
      // короткоживущий подписанный download-URL. Поэтому imageUrl указывает
      // на наш собственный прокси-роут, который перевыпускает свежую ссылку
      // на каждый просмотр (см. /api/trade-images/view).
      const { path } = await uploadFile(accessToken, filename, detected, buf);
      await publishResource(accessToken, path);
      imageUrl = `/api/trade-images/view?tradeKey=${encodeURIComponent(tradeKey)}`;
      imageFileId = path;
    }

    await prisma.tradeAnnotation.upsert({
      where: { userId_tradeKey: { userId: user.userId, tradeKey } },
      create: { userId: user.userId, tradeKey, imageUrl, imageProvider: provider, imageFileId },
      update: { imageUrl, imageProvider: provider, imageFileId },
    });
    bumpStatsVersion(user.userId);

    return NextResponse.json({ imageUrl, imageProvider: provider });
  } catch (err) {
    if (err instanceof GoogleDriveError || err instanceof YandexDiskError) {
      // Реальную причину (ответ API провайдера — не enabled API, quota,
      // invalid scope и т.п.) видно только в логе, клиенту — общее сообщение.
      logError(`${provider} upload failed: ${err.message}`, { path: "/api/trade-images" });
      return badRequest("Не удалось загрузить файл в облако");
    }
    return serverError((err as Error).message);
  }
}

// Удаляет только ссылку у нас — файл в облаке пользователя остаётся
// нетронутым независимо от провайдера (сознательное решение, см.
// TRADE_IMAGE_LINK_PLAN.md).
export async function DELETE(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const tradeKey = url.searchParams.get("tradeKey");
  if (!tradeKey || tradeKey.length > 200) return badRequest("Некорректный tradeKey");

  try {
    await prisma.tradeAnnotation.updateMany({
      where: { userId: user.userId, tradeKey },
      data: { imageUrl: null, imageProvider: null, imageFileId: null },
    });
    bumpStatsVersion(user.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
