"use client";

import { useEffect, useRef } from "react";

// Маячок присутствия для статуса «онлайн» в админке.
//
// Зачем отдельный маячок: открытая вкладка дашборда сама по себе стучится на
// сервер (SyncProvider раз в минуту, поддержка и уведомления раз в 30-60 с), и
// раньше этого хватало, чтобы человек считался онлайн сутками — вкладку просто
// забыли закрыть. Здесь пинг уходит, только когда:
//   • вкладка видима (свёрнутое окно и фоновая вкладка не в счёт);
//   • было хоть какое-то действие мышью/клавиатурой/скроллом за IDLE_MS.
const PING_MS = 60_000;
const IDLE_MS = 5 * 60_000;

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "scroll", "touchstart", "mousemove"] as const;

export default function PresenceBeacon() {
  // Инициализация нулём, а не Date.now(): вызывать импурную функцию в теле
  // компонента нельзя (react-hooks/purity). Первую отметку ставит эффект —
  // открытие страницы само по себе считается действием.
  const lastAction = useRef(0);

  useEffect(() => {
    const bump = () => {
      lastAction.current = Date.now();
    };
    bump();
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, bump, { passive: true });

    const ping = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastAction.current > IDLE_MS) return;
      fetch("/api/presence", { method: "POST", keepalive: true }).catch(() => {
        // офлайн или блокировщик — на следующем тике попробуем снова
      });
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      // Вернулись на вкладку — это тоже действие, ждать минуту незачем.
      bump();
      ping();
    };
    document.addEventListener("visibilitychange", onVisibility);

    ping();
    const iv = setInterval(ping, PING_MS);

    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, bump);
    };
  }, []);

  return null;
}
