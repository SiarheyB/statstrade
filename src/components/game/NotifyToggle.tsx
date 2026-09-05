"use client";

// Тумблер системных уведомлений.
//
// Отдельная кнопка, а не автоматический запрос при входе: браузер отклоняет
// запрос разрешения без жеста пользователя, а окно «Разрешить уведомления?»,
// выскочившее само на первой секунде, почти всегда закрывают отказом — и
// вернуть его потом можно только через настройки браузера.
import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import {
  disableNotifications,
  enableNotifications,
  notificationsEnabled,
  notificationsSupported,
} from "@/lib/game/desktopNotify";

export default function NotifyToggle() {
  const { t } = useI18n();
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);

  // Читаем только в эффекте: страница рендерится и на сервере, где ни
  // Notification, ни localStorage не существует.
  useEffect(() => {
    setSupported(notificationsSupported());
    setOn(notificationsEnabled());
  }, []);

  if (!supported) return null;
  const Icon = on ? Bell : BellOff;

  return (
    <button
      type="button"
      title={t(on ? "game.notify.on" : "game.notify.off")}
      onClick={() => {
        if (on) {
          disableNotifications();
          setOn(false);
          return;
        }
        void enableNotifications().then(setOn);
      }}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition ${
        on ? "text-accent" : "text-muted hover:text-fg"
      }`}
    >
      <Icon size={14} />
      <span className="hidden sm:inline">{t(on ? "game.notify.on" : "game.notify.off")}</span>
    </button>
  );
}
