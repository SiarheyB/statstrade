import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { bumpStatsVersion } from "@/lib/statsCache";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { detectImageType, isAllowedImageType, extForMime, MAX_IMAGE_BYTES } from "@/lib/imageValidation";
import { getValidCloudToken, firstConnectedProvider, type CloudProvider } from "@/lib/integrations/cloudStorage";
import {
  uploadImage,
  makeFilePublic,
  directImageUrl,
  getOrCreateAppFolder,
  getOrCreateNestedFolders,
  GoogleDriveError,
} from "@/lib/integrations/googleDrive";
import { uploadFile, publishResource, getPublicUrl, YandexDiskError } from "@/lib/integrations/yandexDisk";
import { logError } from "@/lib/errorLog";
import { buildTradeImageName } from "@/lib/tradeImageName";

// Скриншоты кладём в отдельную папку, а не в корень "Мой диск"/"Приложения"
// пользователя — так их легко найти и они не мешаются среди остальных файлов.
// Для Яндекс.Диска подпапка того же имени зашита в lib/integrations/yandexDisk.ts
// (DEAL_FOLDER) — там своя структура путей, но имя то же самое сознательно.
const DEAL_FOLDER_NAME = "tradingstat_deal";

// Строит подпапки "год/месяц/паттерн" внутри DEAL_FOLDER_NAME — так
// скриншоты не копятся все в одной куче, а разложены по времени входа и
// торговому паттерну. Год и месяц — отдельные уровни (в папке года лежат
// 12 папок месяцев "01".."12"), а не одна папка "год-месяц". Если entryTime
// не распознан или pattern не задан, используем безопасные фоллбэки, чтобы
// загрузка не ломалась из-за косметики (та же логика, что в buildTradeImageName).
function buildFolderSegments(entryTimeIso: string | null, pattern: string | null): string[] {
  const entryMs = entryTimeIso ? Date.parse(entryTimeIso) : NaN;
  let year: string;
  let month: string;
  if (Number.isFinite(entryMs)) {
    const d = new Date(entryMs);
    year = String(d.getUTCFullYear());
    month = String(d.getUTCMonth() + 1).padStart(2, "0");
  } else {
    year = "unknown-date";
    month = "unknown-date";
  }

  const cleanPattern = pattern?.trim().replace(/[\\/]/g, "_").slice(0, 60);

  return [year, month, cleanPattern || "no_pattern"];
}

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
  // Необязательные, только для человекочитаемого имени файла на диске
  // пользователя — сама привязка идёт по tradeKey, эти поля ни на что
  // больше не влияют, поэтому при их отсутствии просто откатываемся на
  // старое имя вместо ошибки.
  const symbolRaw = form.get("symbol");
  const entryTimeRaw = form.get("entryTime");
  const resultRaw = form.get("result");
  const patternRaw = form.get("pattern");
  if (typeof tradeKey !== "string" || !tradeKey.trim() || tradeKey.length > 200) {
    return badRequest("Некорректный tradeKey");
  }
  if (!(file instanceof File)) {
    return badRequest("Файл не найден в запросе");
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return badRequest(`Файл слишком большой (максимум ${MAX_IMAGE_BYTES / (1024 * 1024)} МБ)`);
  }

  let provider: CloudProvider | null = null;
  let accessToken: string | null;
  try {
    provider = await firstConnectedProvider(user.userId);
    if (!provider) {
      return badRequest("Облачное хранилище не подключено — подключите его в настройках");
    }
    accessToken = await getValidCloudToken(user.userId, provider);
  } catch (err) {
    // Сеть до OAuth-эндпоинта провайдера (обновление токена) недоступна — без
    // этого catch исключение улетало мимо try/catch ниже необработанным:
    // фреймворк отдавал не-JSON 500, клиент падал на res.json() и показывал
    // общее "Upload failed", а в логе оставалось голое "TypeError: fetch
    // failed" без причины (cause) и без стека — serverError() их не передаёт.
    const e = err as Error & { cause?: unknown };
    const cause = e.cause instanceof Error ? e.cause.message : typeof e.cause === "string" ? e.cause : null;
    logError(`${provider ?? "cloud"} token refresh failed: ${e.message}${cause ? ` (${cause})` : ""}`, {
      path: "/api/trade-images",
      stack: e.stack,
    });
    return badRequest("Не удалось обновить доступ к облаку, попробуйте позже");
  }
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

  const entryTimeStr = typeof entryTimeRaw === "string" ? entryTimeRaw : null;
  const patternStr = typeof patternRaw === "string" ? patternRaw : null;

  const filename = buildTradeImageName(
    typeof symbolRaw === "string" ? symbolRaw : null,
    entryTimeStr,
    typeof resultRaw === "string" ? resultRaw : null,
    tradeKey,
    extForMime(detected),
  );
  const folderSegments = buildFolderSegments(entryTimeStr, patternStr);

  try {
    let imageUrl: string;
    let imageFileId: string;
    let imagePublicUrl: string | null;

    if (provider === "google_drive") {
      const dealFolderId = await getOrCreateAppFolder(accessToken, DEAL_FOLDER_NAME);
      const folderId = await getOrCreateNestedFolders(accessToken, dealFolderId, folderSegments);
      const { id: fileId } = await uploadImage(accessToken, filename, detected, buf, folderId);
      await makeFilePublic(accessToken, fileId);
      imageUrl = directImageUrl(fileId);
      imageFileId = fileId;
      // У Google Drive imageUrl и так уже публичная прямая ссылка.
      imagePublicUrl = imageUrl;
    } else {
      // Яндекс.Диск не даёт постоянной прямой ссылки на байты файла — только
      // короткоживущий подписанный download-URL. Поэтому imageUrl указывает
      // на наш собственный прокси-роут, который перевыпускает свежую ссылку
      // на каждый просмотр (см. /api/trade-images/view).
      const { path } = await uploadFile(accessToken, filename, detected, buf, folderSegments);
      await publishResource(accessToken, path);
      imageUrl = `/api/trade-images/view?tradeKey=${encodeURIComponent(tradeKey)}`;
      imageFileId = path;
      // Отдельная публичная ссылка (страница просмотра Яндекса) — работает
      // без входа в приложение, в отличие от imageUrl выше. Best-effort: если
      // не получилось — не валим весь аплоад, просто не будет публичной ссылки.
      imagePublicUrl = await getPublicUrl(accessToken, path).catch(() => null);
    }

    await prisma.tradeAnnotation.upsert({
      where: { userId_tradeKey: { userId: user.userId, tradeKey } },
      create: { userId: user.userId, tradeKey, imageUrl, imageProvider: provider, imageFileId, imagePublicUrl },
      update: { imageUrl, imageProvider: provider, imageFileId, imagePublicUrl },
    });
    bumpStatsVersion(user.userId);

    return NextResponse.json({ imageUrl, imageProvider: provider, imagePublicUrl });
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
      data: { imageUrl: null, imageProvider: null, imageFileId: null, imagePublicUrl: null },
    });
    bumpStatsVersion(user.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
