// Проверка загружаемого файла — НЕ доверяем Content-Type, присланному
// браузером/клиентом (его легко подделать). Определяем реальный тип по
// magic bytes (сигнатуре файла) и разрешаем только растровые форматы
// изображений. Так отсекаются как случайные, так и намеренно подделанные
// файлы (например .html/.svg с встроенным script, переименованные в .png).

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 МБ

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

// Возвращает реальный MIME по сигнатуре файла, либо null, если это не одно
// из разрешённых растровых изображений.
export function detectImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF: "GIF87a" | "GIF89a"
  const gifHeader = buf.subarray(0, 6).toString("ascii");
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
    return "image/gif";
  }
  // WEBP: "RIFF"....."WEBP"
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

export function isAllowedImageType(mime: string): boolean {
  return ALLOWED.has(mime);
}

export function extForMime(mime: string): string {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    default: return "bin";
  }
}
