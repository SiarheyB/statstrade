import { getSession } from "@/lib/auth";
import { redirectLocal } from "@/lib/api";
import { detectBot } from "@/lib/traffic/bots";
import { recordDownload, type Product } from "@/lib/downloads";
import { latestPerimetr, type PerimetrPlatform } from "@/lib/perimetrFiles";

export const dynamic = "force-dynamic";

// Установщики «Периметра» отдаёт nginx из /srv/perimetr/files (см.
// deploy/nginx/nginx.conf). Ссылка «скачать» ведёт сюда: приложение находит
// самую свежую версию в папке (lib/perimetrFiles.ts), считает скачивание вместе
// с номером версии и перенаправляет на файл. Ссылки открыты и без входа — как
// раньше, — так что кто скачал, известно только когда сессия есть.
const TARGETS: Record<string, { product: Product; platform: PerimetrPlatform }> = {
  windows: { product: "perimetr-windows", platform: "windows" },
  mac: { product: "perimetr-macos", platform: "mac" },
  macos: { product: "perimetr-macos", platform: "mac" },
  android: { product: "perimetr-android", platform: "android" },
};

export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const target = TARGETS[platform];
  if (!target) return new Response("Not found", { status: 404 });

  // Роботы (превью ссылок, сканеры) в счёт не идут, но файл получают.
  const bot = detectBot({
    userAgent: req.headers.get("user-agent"),
    acceptLanguage: req.headers.get("accept-language"),
    secFetchMode: req.headers.get("sec-fetch-mode"),
  });
  const latest = await latestPerimetr(target.platform);
  if (!bot.isBot) {
    const session = await getSession().catch(() => null);
    const user = session && !session.demo ? session : null;
    await recordDownload(req, { product: target.product, userId: user?.userId, email: user?.email, version: latest.version });
  }
  // Не кэшируем: иначе браузер запомнит переход и повторное скачивание не посчитается.
  const res = redirectLocal(`/perimetr/files/${latest.file}`, 302);
  res.headers.set("cache-control", "no-store");
  return res;
}
