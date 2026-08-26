"use client";

// «Не гасить экран, пока открыт график» — общий хук для /dashboard/forex,
// /dashboard/orderflow и /dashboard/liqmap.
//
// Зачем вообще: во время фильма браузер сам просит систему не засыпать —
// это делает воспроизведение <video>. Живой график такой поблажки не получает:
// с точки зрения ОС мышь и клавиатура не трогались, значит человек отошёл, и
// монитор гаснет через несколько минут. Единственный способ сказать «я тут,
// я смотрю» — Screen Wake Lock API.
//
// Тумблера нет намеренно: страница графика открыта — значит на неё смотрят.
// Границы API и так делают удержание безобидным:
//  * блокировка живёт, только пока вкладка ВИДИМА — свернул окно или ушёл на
//    другую вкладку, и система снова вольна гасить экран;
//  * уход со страницы графика её снимает (размонтирование хука);
//  * система сама отбирает блокировку при сне по крышке/кнопке;
//  * нужен защищённый контекст (https или localhost) — иначе API просто нет,
//    и хук молча ничего не делает.

import { useEffect } from "react";

type Sentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", cb: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<Sentinel> };
};

/** Держит экран включённым, пока смонтирован вызывающий компонент. */
export function useWakeLock(): void {
  useEffect(() => {
    const api = (navigator as WakeLockNavigator).wakeLock;
    if (!api) return;

    let cancelled = false;
    let sentinel: Sentinel | null = null;

    const acquire = async () => {
      if (cancelled || sentinel) return;
      // Запрос из скрытой вкладки заведомо отклоняется — ждём возвращения.
      if (document.visibilityState !== "visible") return;
      try {
        const next = await api.request("screen");
        if (cancelled) {
          await next.release().catch(() => {});
          return;
        }
        sentinel = next;
        // Систему никто не обязывает держать блокировку вечно: она снимает её
        // при сворачивании, блокировке ноутбука, переходе в энергосбережение.
        // Дальше её вернёт visibilitychange.
        next.addEventListener("release", () => {
          if (sentinel === next) sentinel = null;
        });
      } catch {
        // NotAllowedError: политика браузера или экономия батареи. Живём без
        // удержания — ронять из-за этого страницу графика незачем.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const held = sentinel;
      sentinel = null;
      if (held && !held.released) held.release().catch(() => {});
    };
  }, []);
}
