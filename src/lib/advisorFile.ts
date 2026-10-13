import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";

// Файл из образа: запасной вариант, пока админ ничего не загружал.
const BUNDLED = path.join(process.cwd(), "downloads", "TradeGridPanel.ex5");
// Номер версии бандл-файла (был зашит в AdvisorView).
export const BUNDLED_LABEL = "2.10";

export type AdvisorBuild = {
  data: Buffer;
  label: string;
  version: string; // ISO: когда загружен / изменён файл
  source: "upload" | "bundled";
};

/** Актуальная сборка советника, либо null, если нет ни загрузки, ни файла в образе. */
export async function getAdvisorBuild(): Promise<AdvisorBuild | null> {
  const row = await prisma.advisorFile.findUnique({ where: { id: "current" } });
  if (row) {
    return { data: Buffer.from(row.data), label: row.label, version: row.uploadedAt.toISOString(), source: "upload" };
  }
  try {
    const [data, st] = await Promise.all([readFile(BUNDLED), stat(BUNDLED)]);
    return { data, label: BUNDLED_LABEL, version: st.mtime.toISOString(), source: "bundled" };
  } catch {
    return null;
  }
}

/** Только номер версии — без вычитывания файла, для страницы советника. */
export async function getAdvisorLabel(): Promise<string> {
  const row = await prisma.advisorFile.findUnique({ where: { id: "current" }, select: { label: true } });
  return row?.label ?? BUNDLED_LABEL;
}
