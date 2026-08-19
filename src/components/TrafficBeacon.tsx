"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Браузерный маячок посещаемости. Основной счёт идёт на сервере (middleware),
// этот компонент добавляет к нему то, чего в заголовках запроса нет:
//  • факт «JS исполнился» → визит помечается как человеческий надёжно;
//  • переходы, отданные App Router из клиентского кэша без запроса к серверу;
//  • разрешение экрана и document.referrer.
// Дубли серверного события отсекаются на приёме (одинаковый путь в одном
// визите за 5 секунд считается одним просмотром).
export default function TrafficBeacon() {
  const pathname = usePathname();
  const sentPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || sentPath.current === pathname) return;
    sentPath.current = pathname;
    const body = JSON.stringify({
      path: pathname,
      referrer: document.referrer || null,
      screen: `${window.screen.width}x${window.screen.height}`,
    });
    // keepalive — чтобы запрос дожил, если человек сразу уходит со страницы.
    fetch("/api/analytics/beacon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // блокировщик или офлайн — статистика всё равно посчитана на сервере
    });
  }, [pathname]);

  return null;
}
