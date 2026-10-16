// Сжимает файл отчёта в браузере перед отправкой. Если CompressionStream нет
// (старый браузер) или что-то пошло не так — возвращает исходный файл: сервер
// принимает оба варианта.
export async function gzipForUpload(file: File): Promise<File> {
  try {
    if (typeof CompressionStream === "undefined") return file;
    const stream = file.stream().pipeThrough(new CompressionStream("gzip"));
    const blob = await new Response(stream).blob();
    if (blob.size >= file.size) return file;
    return new File([blob], file.name, { type: "application/gzip" });
  } catch {
    return file;
  }
}
