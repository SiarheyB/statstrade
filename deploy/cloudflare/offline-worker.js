// Cloudflare Worker — фолбэк «технический перерыв» на случай, когда origin
// (домашний сервер) недоступен ЦЕЛИКОМ: света нет, cloudflared лежит и т.п.
// Работает на edge Cloudflare, поэтому показывается даже при обесточенном хосте.
//
// Логика: проксируем запрос на origin как есть. Если Cloudflare вернул
// gateway-ошибку (52x/530 — туннель мёртв) или fetch упал — навигационным
// запросам (HTML) отдаём брендированную страницу с автообновлением; всё
// остальное (API/статика) пропускаем без подмены.
//
// Подключение (5 минут, см. docs/local/CLOUDFLARE_TUNNEL.md, раздел «Фолбэк»):
//   Dashboard → Workers & Pages → Create → Worker → вставить этот файл → Deploy,
//   затем на странице воркера: Settings → Domains & Routes → Add route:
//   tradingstat.ru/* (zone: tradingstat.ru). Free-план: 100k запросов/день —
//   воркер исполняется на КАЖДЫЙ запрос зоны; при росте трафика либо Workers
//   Paid ($5/мес), либо сузить маршрут.
//
// NB: HTML продублирован из deploy/nginx/offline.html (воркер должен быть
// самодостаточным) — правите один, поправьте и второй.

const GATEWAY_ERRORS = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);

export default {
  async fetch(request) {
    const wantsHtml = (request.headers.get("accept") || "").includes("text/html");
    try {
      const resp = await fetch(request);
      if (wantsHtml && GATEWAY_ERRORS.has(resp.status)) return offline();
      return resp;
    } catch {
      return wantsHtml
        ? offline()
        : new Response(JSON.stringify({ error: "Сервис временно недоступен" }), {
            status: 503,
            headers: { "content-type": "application/json; charset=utf-8", "retry-after": "30" },
          });
    }
  },
};

function offline() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "30",
    },
  });
}

const OFFLINE_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>TradeStats — технический перерыв</title>
<style>
  :root{
    --bg:#0a0e17; --surface:#131a27; --border:#283044; --fg:#eef2f8;
    --muted:#94a0b5; --faint:#5d6779; --accent:#3b82f6; --profit:#16c784;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{
    background:var(--bg); color:var(--fg);
    font:16px/1.6 "Manrope",system-ui,-apple-system,"Segoe UI",sans-serif;
    display:flex; align-items:center; justify-content:center; padding:24px;
    background-image:radial-gradient(60% 50% at 50% 0%, rgba(59,130,246,.08), transparent 70%);
  }
  .card{
    max-width:460px; width:100%; text-align:center;
    background:var(--surface); border:1px solid var(--border); border-radius:16px;
    padding:48px 36px 40px;
  }
  .logo{
    display:inline-flex; align-items:center; gap:10px; font-weight:700; font-size:20px;
    letter-spacing:-.02em; margin-bottom:28px;
  }
  .logo-mark{
    width:36px;height:36px;border-radius:9px;background:rgba(59,130,246,.15);
    display:inline-flex;align-items:center;justify-content:center;
  }
  .pulse{
    width:10px;height:10px;border-radius:50%;background:var(--accent);
    animation:pulse 1.6s ease-in-out infinite; margin:0 auto 20px;
  }
  @keyframes pulse{
    0%,100%{transform:scale(1);opacity:1;box-shadow:0 0 0 0 rgba(59,130,246,.5)}
    50%{transform:scale(1.15);opacity:.85;box-shadow:0 0 0 12px rgba(59,130,246,0)}
  }
  h1{font-size:22px;letter-spacing:-.01em;margin-bottom:10px}
  p{color:var(--muted);font-size:14.5px}
  .note{color:var(--faint);font-size:12.5px;margin-top:24px}
  .retry{margin-top:6px;color:var(--faint);font-size:12.5px;font-variant-numeric:tabular-nums}
  .ok{color:var(--profit)}
  @media (prefers-reduced-motion:reduce){.pulse{animation:none}}
</style>
</head>
<body>
  <main class="card" role="status" aria-live="polite">
    <div class="logo">
      <span class="logo-mark">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.4" stroke-linecap="round">
          <path d="M4 19V9M10 19V5M16 19v-8M22 19H2"/>
        </svg>
      </span>
      TradeStats
    </div>
    <div class="pulse" aria-hidden="true"></div>
    <h1>Технический перерыв</h1>
    <p>Сервис ненадолго недоступен — идёт обновление или перезапуск.
       Ваши данные в безопасности, ничего не потеряется.</p>
    <p class="retry" id="retry">Проверяем соединение…</p>
    <p class="note">Страница обновится сама, как только сервис вернётся.</p>
  </main>
<script>
  (function () {
    var el = document.getElementById("retry");
    var delay = 5;
    var left = delay;
    function tick() {
      el.textContent = "Повторная проверка через " + left + " с…";
      if (left-- > 0) return setTimeout(tick, 1000);
      el.textContent = "Проверяем соединение…";
      fetch("/", { method: "HEAD", cache: "no-store" })
        .then(function (r) {
          if (r.ok || (r.status >= 300 && r.status < 400)) {
            el.textContent = "Сервис доступен — загружаем…";
            el.className = "retry ok";
            location.reload();
          } else { throw 0; }
        })
        .catch(function () {
          delay = Math.min(delay * 2, 60);
          left = delay;
          setTimeout(tick, 1000);
        });
    }
    setTimeout(tick, 1000);
  })();
</script>
</body>
</html>`;
