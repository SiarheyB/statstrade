import { Eye } from "lucide-react";
import { getServerT } from "@/lib/i18n/server";

/**
 * Плашка демо-режима над дашбордом. Гость видит настоящий интерфейс на общих
 * данных; кнопка выхода — POST-форма на /api/demo/exit (единственный
 * изменяющий запрос, который middleware пропускает от демо-сессии).
 */
export default async function DemoBanner() {
  const { t } = await getServerT();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm">
      <span className="flex items-center gap-2 text-warn">
        <Eye size={15} />
        {t("demo.banner")}
      </span>
      <div className="flex items-center gap-2">
        <a
          href="/register"
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent/90"
        >
          {t("landing.ctaCreate")}
        </a>
        <form action="/api/demo/exit" method="post">
          <button
            type="submit"
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-fg transition hover:border-border-strong"
          >
            {t("demo.exit")}
          </button>
        </form>
      </div>
    </div>
  );
}
