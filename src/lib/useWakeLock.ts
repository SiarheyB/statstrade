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
// Границы, которые API ставит за нас (и почему это безопасно держать
// включённым по умолчанию):
//  * блокировка живёт, только пока вкладка ВИДИМА — свернул окно или ушёл на
//    другую вкладку, и система снова вольна гасить экран;
//  * система сама отбирает блокировку при уходе в сон по крышке/кнопке;
//  * нужен защищённый контекст (https или localhost) — иначе API просто нет.

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "ts_keep_awake";
/** Настройка меняется кнопкой — внутри одной вкладки `storage` не срабатывает. */
const CHANGE_EVENT = "ts:keep-awake";

type Sentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", cb: () => void) => void;
  removeEventListener: (type: "release", cb: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<Sentinel> };
};

function readEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // Значения нет — включено: человек, открывший живой график, хочет его видеть.
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

export type WakeLockState = {
  /** Есть ли API вообще (нет — кнопку показывать незачем). */
  supported: boolean;
  /** Хочет ли пользователь удерживать экран. */
  enabled: boolean;
  /** Держится ли блокировка прямо сейчас (вкладка видима и запрос удался). */
  active: boolean;
  toggle: () => void;
};

export function useWakeLock(): WakeLockState {
  // На сервере API нет, поэтому supported всегда стартует с false и уточняется
  // в эффекте — разметка сервера и клиента совпадают.
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [active, setActive] = useState(false);
  const sentinelRef = useRef<Sentinel | null>(null);

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && "wakeLock" in navigator);
    setEnabled(readEnabled());
    const onChange = () => setEnabled(readEnabled());
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (!supported || !enabled) return;
    let cancelled = false;

    const release = async () => {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      setActive(false);
      if (sentinel && !sentinel.released) {
        try {
          await sentinel.release();
        } catch {
          // Уже отобрана системой — ничего делать не нужно.
        }
      }
    };

    const acquire = async () => {
      if (cancelled || sentinelRef.current) return;
      // Запрос из скрытой вкладки заведомо отклоняется — ждём возвращения.
      if (document.visibilityState !== "visible") return;
      try {
        const sentinel = await (navigator as WakeLockNavigator).wakeLock!.request("screen");
        if (cancelled) {
          await sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        setActive(true);
        // Систему никто не обязывает держать блокировку вечно: она снимает её
        // при сворачивании, блокировке ноутбука, переходе в энергосбережение.
        sentinel.addEventListener("release", () => {
          if (sentinelRef.current === sentinel) {
            sentinelRef.current = null;
            setActive(false);
          }
        });
      } catch {
        // NotAllowedError: политика браузера или экономия батареи.
        // Молча остаёмся без блокировки — кнопка покажет, что она не держится.
        setActive(false);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
      else setActive(false);
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [supported, enabled]);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Приватный режим — выбор не переживёт перезагрузку, и только.
      }
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
      return next;
    });
  }, []);

  return { supported, enabled, active, toggle };
}

export const KEEP_AWAKE_KEY = STORAGE_KEY;
export const KEEP_AWAKE_EVENT = CHANGE_EVENT;
