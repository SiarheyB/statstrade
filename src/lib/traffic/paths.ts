// Нормализация путей для статистики посещаемости.
//
// Две задачи:
//  1. Не дробить «топ страниц» на тысячи строк с id в пути — /admin/users/ckxyz
//     и /admin/users/ckabc это одна страница /admin/users/[id].
//  2. Не тащить в таблицу секреты. /share/<token> — публичная ссылка на
//     статистику, сам токен и есть ключ доступа: в логах посещаемости ему не
//     место. Поэтому динамический сегмент заменяется шаблоном ВСЕГДА, а
//     query-строка не сохраняется целиком (только utm-метки, см. referrer.ts).

// Шаблоны реальных динамических маршрутов приложения.
const DYNAMIC: { re: RegExp; to: string }[] = [
  { re: /^\/share\/[^/]+/, to: "/share/[token]" },
  { re: /^\/admin\/users\/[^/]+/, to: "/admin/users/[id]" },
  { re: /^\/admin\/support\/[^/]+/, to: "/admin/support/[ticketId]" },
];

// Похоже на идентификатор, а не на человекочитаемый сегмент: cuid/uuid/hash/
// длинное число. Страхует от новых динамических маршрутов, о которых здесь
// забыли, — иначе они начнут засорять топ страниц и утекать id.
const IDISH = /^(?:[0-9]+|c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[A-Za-z0-9_-]{22,})$/;

/** Статика и служебные пути Next — в статистику посещаемости не идут. */
const SKIP =
  /^\/(?:_next\/|__nextjs|favicon\.ico|robots\.txt|sitemap\.xml|manifest\.json|sw\.js|apple-touch-icon|.*\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|map|txt|xml|json|woff2?|ttf|eot|mp4|webm))/i;

/**
 * Считать ли запрос просмотром страницы.
 *
 * /api/* исключён намеренно: это фоновые опросы уже открытой вкладки
 * (синхронизация, стакан, уведомления) — десятки запросов в минуту на одного
 * человека. Смешивать их с просмотрами страниц — гарантированно бессмысленные
 * цифры. Исключение — попытки роботов лезть в API: они всё равно попадут в
 * статистику через сканерские пути, которые к /api не относятся.
 */
export function isTrackablePath(pathname: string): boolean {
  if (!pathname.startsWith("/")) return false;
  if (pathname.startsWith("/api/")) return false;
  return !SKIP.test(pathname);
}

/** Путь → шаблон страницы: без query, без хвостового слэша, без id. */
export function normalizePath(pathname: string): string {
  let p = (pathname || "/").split("?")[0].split("#")[0];
  if (p.length > 1) p = p.replace(/\/+$/, "");
  if (!p) p = "/";
  for (const d of DYNAMIC) {
    if (d.re.test(p)) return d.to;
  }
  const parts = p.split("/").map((seg) => (IDISH.test(seg) ? "[id]" : seg));
  const out = parts.join("/") || "/";
  return out.slice(0, 200);
}
