"use client";

import { useCallback, useEffect, useState } from "react";
import { BellDot } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";
import { pushState, subscribePush, unsubscribePush, type PushState } from "@/lib/push/client";

// Карточка «Push-уведомления» в /dashboard/settings.
//
// Отличие от соседней карточки «Напоминания о новостях» (EconCalAlertSettings):
// та настраивает всплывашки в ОТКРЫТОЙ вкладке и живёт в localStorage, а эта —
// подписка устройства на сервере, которая работает при закрытом браузере.
// Поэтому здесь нет ни одной настройки «что присылать»: тумблер отвечает на
// вопрос «можно ли вообще присылать на ЭТО устройство», а что именно присылать,
// человек выбирает там, где заводит уведомление (колокольчик у уровня в
// «Рекомендациях», важность событий в карточке новостей).

export default function PushSettings() {
  const { t } = useI18n();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  // Состояние читается только в браузере: на сервере нет ни service worker, ни
  // Notification.permission, и до первого эффекта карточка не рисуется вовсе.
  useEffect(() => {
    let alive = true;
    pushState()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState("unsupported"));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (busy || !state) return;
    setBusy(true);
    try {
      setState(state === "on" ? await unsubscribePush() : await subscribePush());
    } finally {
      setBusy(false);
    }
  }, [busy, state]);

  // Сервер без VAPID-ключей — предлагать нечего, карточку прячем целиком.
  // То же самое до первой загрузки состояния: мигать заглушкой в списке
  // настроек некрасиво.
  if (state === null || state === "unconfigured") return null;

  const blocked = state === "denied" || state === "unsupported";
  const statusKey =
    state === "denied" ? "push.blocked" : state === "unsupported" ? "push.unsupported" : null;

  return (
    <div className="card p-5 mb-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-medium text-sm flex items-center gap-2">
            <BellDot size={15} className="text-accent" />
            {t("push.title")}
          </h3>
          <p className="text-xs text-faint mt-0.5 max-w-md">{t("push.hint")}</p>
        </div>
        <button
          role="switch"
          aria-checked={state === "on"}
          aria-label={t("push.title")}
          disabled={busy || blocked}
          onClick={toggle}
          className={clsx(
            "relative inline-flex h-6 w-11 items-center rounded-full transition shrink-0 disabled:opacity-40",
            state === "on" ? "bg-accent" : "bg-surface-2 border border-border",
          )}
        >
          <span
            className={clsx(
              "inline-block h-4 w-4 rounded-full bg-white transition",
              state === "on" ? "translate-x-6" : "translate-x-1",
            )}
          />
        </button>
      </div>

      <p className="text-[11px] text-faint mt-3 leading-relaxed max-w-md">
        {statusKey ? t(statusKey) : state === "on" ? t("push.onNote") : t("push.offNote")}
      </p>
    </div>
  );
}
