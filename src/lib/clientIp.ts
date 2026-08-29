// Адрес клиента из заголовков прокси — ОДНА реализация на всё приложение.
//
// По нему ключуются все лимиты (вход, регистрация, 2FA, поддержка, загрузка
// картинок, см. lib/ratelimit.ts) и считается идентификатор посетителя в
// статистике (lib/traffic/hit.ts). Раньше это были две копии, и они молча
// разъезжались.
//
// Отдельный модуль, а не функция внутри ratelimit.ts: hit.ts работает в
// edge-рантайме middleware, и тянуть туда лимитер ради одной функции незачем —
// заодно роутам, которые мокают ratelimit в тестах, не приходится знать про
// внутренности аналитики.
//
// ГРАБЛИ, из-за которых лимиты не работали вовсе. Раньше первым читался
// `cf-connecting-ip`, а из `x-forwarded-for` брался ПЕРВЫЙ элемент. Оба целиком
// под контролем клиента: перед приложением стоит наш nginx, он проставлял
// `X-Forwarded-For $proxy_add_x_forwarded_for` (ДОПИСЫВАЕТ к присланному, то
// есть первым остаётся значение клиента) и не трогал `cf-connecting-ip` вовсе —
// Cloudflare, который эти заголовки нормализует, в схеме отсутствует, наружу
// смотрит Tailscale Funnel. Достаточно было слать `cf-connecting-ip` со
// случайным значением на каждый запрос, чтобы снять ограничение на подбор
// пароля, регистрацию и залив таблицы просмотров.
//
// Теперь доверяем только тому, что проставил наш прокси. Парная правка —
// deploy/nginx/nginx.conf: XFF выставляется ЗАМЕНОЙ, cf-connecting-ip и
// true-client-ip затираются.

export function clientIpFromHeaders(h: Headers): string {
  // Cloudflare читаем, только если явно объявлено, что он действительно перед
  // нами: он перезаписывает свой заголовок сам, подделать его снаружи нельзя.
  if (process.env.TRUST_CF_HEADERS === "1") {
    const cf = h.get("cf-connecting-ip");
    if (cf) return cf.trim();
  }
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = h.get("x-forwarded-for");
  if (xff) {
    // ПОСЛЕДНИЙ элемент — ближайший к нам, его дописал прокси; всё, что левее,
    // мог написать сам клиент.
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return "unknown";
}

export function clientIpFromRequest(req: Request): string {
  return clientIpFromHeaders(req.headers);
}
