import { readdir } from "node:fs/promises";

// Установщики «Периметра» лежат на хосте в /srv/perimetr/files (их отдаёт nginx,
// см. deploy/nginx/nginx.conf) и проброшены в app только на чтение. Приложение
// само находит самую свежую версию по имени файла, поэтому выкладка новой
// версии — это просто положить файл в папку: симлинки Perimetr-latest-* не
// нужны, перекладывать их некому и незачем.
const DIR = process.env.PERIMETR_FILES_DIR || "/srv/perimetr/files";

export type PerimetrPlatform = "windows" | "mac" | "android";

// Perimetr-<версия>-<хвост>: у Windows .exe (а не .zip — это переносная
// сборка), у macOS — только Apple Silicon, intel-сборки нет.
const SUFFIX: Record<PerimetrPlatform, string> = {
  windows: "windows.exe",
  mac: "arm64.dmg",
  android: "android.apk",
};

/** Сравнение «1.4.10» > «1.4.2» по числам, а не по строке. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Самая новая версия установщика из списка имён файлов, либо null. */
export function pickLatest(names: string[], platform: PerimetrPlatform): { file: string; version: string } | null {
  const suffix = SUFFIX[platform].replace(".", "\\.");
  const re = new RegExp(`^Perimetr-(\\d+(?:\\.\\d+)*)-${suffix}$`);
  let best: { file: string; version: string } | null = null;
  for (const file of names) {
    const m = re.exec(file);
    if (m && (!best || compareVersions(m[1], best.version) > 0)) best = { file, version: m[1] };
  }
  return best;
}

/** Файл для скачивания. Если папку прочитать нельзя — прежнее имя-симлинк. */
export async function latestPerimetr(platform: PerimetrPlatform): Promise<{ file: string; version: string | null }> {
  try {
    const found = pickLatest(await readdir(DIR), platform);
    if (found) return found;
  } catch {
    // папки нет (локальная разработка) или нет прав — запасной вариант ниже
  }
  return { file: `Perimetr-latest-${platform === "mac" ? "arm64.dmg" : platform === "windows" ? "windows.exe" : "android.apk"}`, version: null };
}
