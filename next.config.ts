import type { NextConfig } from "next";

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
