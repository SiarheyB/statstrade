"use client";

// Разворот блока с графиком на весь экран — общий для /dashboard/forex,
// /dashboard/orderflow и /dashboard/liqmap, чтобы вести себя одинаково и
// чиниться в одном месте.
//
// Основной режим — нативный Fullscreen API (уходит и хром браузера, выход по
// Esc бесплатно). Там, где его нет или он запрещён (Safari на iPhone
// не даёт разворачивать произвольный элемент), разворачиваем оверлеем на всё
// окно — с точки зрения вызывающего кода разницы нет, флаг `active` один.

import { useCallback, useEffect, useRef, useState } from "react";

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

function fullscreenElement(): Element | null {
  const doc = document as FsDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

// Канвасы пересчитывают свои размеры по событию resize у окна. Нативный
// переход его шлёт не во всех браузерах, а разворот оверлеем — никогда:
// шлём сами, дав браузеру кадр на применение новых размеров.
function notifyResize() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  });
}

export type FullscreenState<T extends HTMLElement> = {
  /** Вешается на блок, который разворачиваем. */
  ref: React.RefObject<T | null>;
  /** Развёрнут ли блок — неважно, нативно или оверлеем. */
  active: boolean;
  toggle: () => void;
};

export function useFullscreen<T extends HTMLElement>(): FullscreenState<T> {
  const ref = useRef<T>(null);
  const [native, setNative] = useState(false);
  // Разворот без Fullscreen API: элемент на весь вьюпорт средствами CSS.
  const [overlay, setOverlay] = useState(false);

  useEffect(() => {
    const onChange = () => {
      const isOurs = !!ref.current && fullscreenElement() === ref.current;
      setNative(isOurs);
      notifyResize();
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  // В нативном режиме Esc обрабатывает сам браузер, в режиме оверлея — мы.
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOverlay(false);
      notifyResize();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay]);

  // Страница под оверлеем не должна прокручиваться колесом мимо графика.
  useEffect(() => {
    if (!overlay) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [overlay]);

  const toggle = useCallback(() => {
    const el = ref.current as FsElement | null;
    if (!el) return;

    // Нативный фуллскрин недоступен или запрещён — разворачиваем оверлеем
    // во всё окно: снаружи разницы нет, флаг active один.
    const showAsOverlay = () => {
      setOverlay(true);
      notifyResize();
    };

    if (fullscreenElement()) {
      const doc = document as FsDocument;
      const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
      if (exit) void Promise.resolve(exit.call(doc)).catch(() => undefined);
      return;
    }
    if (overlay) {
      setOverlay(false);
      notifyResize();
      return;
    }

    const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
    if (!request) {
      showAsOverlay();
      return;
    }
    // Отказ прилетает двумя разными способами: реджектом промиса или
    // синхронным исключением (так делает встроенный просмотрщик, когда
    // fullscreen запрещён политикой фрейма). Ловим оба — иначе кнопка
    // молча не работает.
    try {
      const started = request.call(el) as Promise<void> | undefined;
      if (started && typeof started.catch === "function") started.catch(showAsOverlay);
    } catch {
      showAsOverlay();
    }
  }, [overlay]);

  return { ref, active: native || overlay, toggle };
}
