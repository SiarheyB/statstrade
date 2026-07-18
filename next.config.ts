import type { NextConfig } from "next";

// Content-Security-Policy. Без nonce (Next-инлайны требуют 'unsafe-inline'),
// но внешние скрипты жёстко ограничены: только Turnstile и Google Sign-In.
// Это закрывает подгрузку чужих скриптов/фреймов при XSS-инъекции, кликджекинг
// (frame-ancestors) и утечку форм на чужой origin (form-action).
// img-src https: — картинки новостей приходят с произвольных доменов фидов.
// В dev Turbopack использует eval и ws — добавляем только там.
const dev = process.env.NODE_ENV === "development";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com https://accounts.google.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws:" : ""} https://challenges.cloudflare.com https://accounts.google.com`,
  "frame-src https://challenges.cloudflare.com https://accounts.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // ccxt is a large server-only library that ships CJS/optional deps the
  // bundler cannot resolve (e.g. protobufjs). Keep it external so it is
  // required from node_modules at runtime instead of being bundled.
  // bcrypt — нативный аддон (.node), его тоже нельзя бандлить.
  serverExternalPackages: ["ccxt", "bcrypt"],
  // Базовые security-заголовки на все ответы. Полный CSP не включаем: Next
  // использует inline-скрипты, а на страницах живут виджеты Turnstile и Google
  // Sign-In — строгая политика требует nonce-инфраструктуры (отдельная задача).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          // Запрет встраивания в чужие iframe (кликджекинг).
          { key: "X-Frame-Options", value: "DENY" },
          // Не угадывать MIME-типы.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Не сливать полный URL (с токенами в query) внешним сайтам.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Браузерные API, которые приложению не нужны.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HSTS: наружу приложение доступно только через HTTPS-туннель
          // (Tailscale Funnel / Cloudflare), заголовок закрепляет это в браузере.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
