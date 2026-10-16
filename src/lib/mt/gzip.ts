import { gunzipSync } from "node:zlib";

// Отчёт MT — HTML, он сжимается в 8–10 раз. Клиент сжимает файл ПЕРЕД отправкой:
// с части российских сетей к серверу доезжают только мелкие запросы, а загрузка
// файла в сотни килобайт зависает (см. разбор в истории коммита). Сервер
// принимает и несжатый файл — старые вкладки и браузеры без CompressionStream.
export function isGzip(buf: Uint8Array): boolean {
  return buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

// Распаковывает gzip, если он есть. maxBytes ограничивает РАСПАКОВАННЫЙ размер,
// иначе маленький архив раздулся бы в память (zip-бомба); при превышении или
// битом архиве бросает Error.
export function gunzipIfNeeded(buf: Buffer, maxBytes: number): Buffer {
  if (!isGzip(buf)) return buf;
  return gunzipSync(buf, { maxOutputLength: maxBytes });
}
