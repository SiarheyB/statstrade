import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { bumpStatsVersion } from "@/lib/statsCache";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { detectImageType, isAllowedImageType, extForMime, MAX_IMAGE_BYTES } from "@/lib/imageValidation";
import { getValidGoogleDriveToken } from "@/lib/integrations/cloudStorage";
import { uploadImage, makeFilePublic, directImageUrl, GoogleDriveError } from "@/lib/integrations/googleDrive";
import { logError } from "@/lib/errorLog";

// Загружает скриншот сделки в Google Drive пользователя (НЕ на наш сервер) и
// сохраняет только публичную ссылку в TradeAnnotation. Файл никогда не
// проходит через постоянное хранилище приложения — читаем его целиком в
// память (лимит 10 МБ), проверяем и сразу пересылаем в Drive API.
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  // Лимит защищает Drive API-квоту пользователя и наш сервер от заливки спама.
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

  const accessToken = await getValidGoogleDriveToken(user.userId);
  if (!accessToken) {
    return badRequest("Google Drive не подключён — подключите его в настройках");
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // Реальный тип определяем по сигнатуре файла, а не по Content-Type от
  // клиента (тот легко подделать) — отсекаем не-изображения (в т.ч. HTML/SVG
  // со скриптами, замаскированные под картинку).
  const detected = detectImageType(buf);
  if (!detected || !isAllowedImageType(detected)) {
    return badRequest("Файл не распознан как изображение (поддерживаются PNG, JPEG, WEBP, GIF)");
  }

  try {
    const filename = `tradestats_${tradeKey.replace(/[^a-zA-Z0-9_-]/g, "_")}.${extForMime(detected)}`;
    const { id: fileId } = await uploadImage(accessToken, filename, detected, buf);
    await makeFilePublic(accessToken, fileId);
    const imageUrl = directImageUrl(fileId);

    await prisma.tradeAnnotation.upsert({
      where: { userId_tradeKey: { userId: user.userId, tradeKey } },
      create: { userId: user.userId, tradeKey, imageUrl, imageProvider: "google_drive", imageFileId: fileId },
      update: { imageUrl, imageProvider: "google_drive", imageFileId: fileId },
    });
    bumpStatsVersion(user.userId);

    return NextResponse.json({ imageUrl, imageProvider: "google_drive" });
  } catch (err) {
    if (err instanceof GoogleDriveError) {
      // Реальную причину (ответ Google API — не enabled API, quota, invalid
      // scope и т.п.) видно только в логе, клиенту — общее сообщение.
      logError(`GoogleDrive upload failed: ${err.message}`, { path: "/api/trade-images" });
      return badRequest("Не удалось загрузить файл в Google Drive");
    }
    return serverError((err as Error).message);
  }
}

// Удаляет только ссылку у нас — файл в Google Drive пользователя остаётся
// нетронутым (сознательное решение, см. TRADE_IMAGE_LINK_PLAN.md).
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
