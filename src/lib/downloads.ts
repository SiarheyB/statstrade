import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { parseUa, primaryLang } from "@/lib/traffic/ua";
import { countryFromHeaders } from "@/lib/traffic/hit";

// Программы, скачивания которых мы считаем (журнал AppDownload, страница
// /admin/downloads). Группа — вкладка в админке.
export const PRODUCTS = {
  advisor: { group: "advisor", label: "MT5" },
  "perimetr-windows": { group: "perimetr", label: "Windows" },
  "perimetr-macos": { group: "perimetr", label: "macOS" },
  "perimetr-android": { group: "perimetr", label: "Android" },
} as const;
export type Product = keyof typeof PRODUCTS;

export function productsOf(group: "advisor" | "perimetr"): Product[] {
  return (Object.keys(PRODUCTS) as Product[]).filter((p) => PRODUCTS[p].group === group);
}

export type DownloadInfo = {
  product: Product;
  userId?: string | null;
  email?: string | null;
  version?: string | null;
  bytes?: number | null;
};

/**
 * Записать скачивание. Сбой записи не должен отнимать у человека файл,
 * поэтому всё глотаем.
 */
export async function recordDownload(req: Request | undefined, info: DownloadInfo): Promise<void> {
  try {
    const h = req?.headers;
    const ua = parseUa(h?.get("user-agent"));
    let referrer: string | null = null;
    try {
      const ref = h?.get("referer");
      if (ref) referrer = new URL(ref).pathname.slice(0, 200);
    } catch {}
    // «Повторно» — тот же пользователь и та же программа. У анонимных
    // (Периметр без входа) признать повтор нечем.
    const before = info.userId
      ? await prisma.appDownload.count({ where: { userId: info.userId, product: info.product } })
      : 0;
    await prisma.appDownload.create({
      data: {
        product: info.product,
        userId: info.userId ?? null,
        email: info.email ?? null,
        version: info.version ?? null,
        bytes: info.bytes ?? null,
        device: ua.device,
        browser: ua.browser,
        os: ua.os,
        country: h ? countryFromHeaders(h) : null,
        lang: primaryLang(h?.get("accept-language")),
        referrer,
        isRepeat: before > 0,
      },
    });
  } catch (e) {
    logger.warn("downloads", info.userId ?? null, "download log failed", { err: String(e) });
  }
}
