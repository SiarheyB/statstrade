import { getSession } from "@/lib/auth";
import { redirectLocal } from "@/lib/api";
import { detectBot } from "@/lib/traffic/bots";
import { recordDownload, type Product } from "@/lib/downloads";

export const dynamic = "force-dynamic";

// Установщики «Периметра» отдаёт nginx из /srv/perimetr/files (см.
// deploy/nginx/nginx.conf), приложение их не видит. Ссылка «скачать» поэтому
// ведёт сюда: считаем скачивание и перенаправляем на стабильное имя файла
// (симлинк Perimetr-latest-*, его перекладывают при выкладке версии).
// Ссылки открыты и без входа — как раньше, — так что кто скачал, известно
// только когда сессия есть.
const TARGETS: Record<string, { product: Product; file: string }> = {
  windows: { product: "perimetr-windows", file: "Perimetr-latest-windows.exe" },
  mac: { product: "perimetr-macos", file: "Perimetr-latest-arm64.dmg" },
  macos: { product: "perimetr-macos", file: "Perimetr-latest-arm64.dmg" },
  android: { product: "perimetr-android", file: "Perimetr-latest-android.apk" },
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
  if (!bot.isBot) {
    const session = await getSession().catch(() => null);
    const user = session && !session.demo ? session : null;
    await recordDownload(req, { product: target.product, userId: user?.userId, email: user?.email });
  }
  // Не кэшируем: иначе браузер запомнит переход и повторное скачивание не посчитается.
  const res = redirectLocal(`/perimetr/files/${target.file}`, 302);
  res.headers.set("cache-control", "no-store");
  return res;
}
