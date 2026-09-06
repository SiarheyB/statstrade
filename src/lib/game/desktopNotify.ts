"use client";

// Системные уведомления игры.
//
// Игра идёт вровень с реальным временем — значит игрок держит вкладку
// открытой и занимается другими делами. Стоп срабатывает, испытание догорает,
// займ просрочен, а узнаёт он об этом, только когда вернётся: всплывающие
// тосты рисуются на странице, на которую никто не смотрит.
//
// Показываем ТОЛЬКО когда вкладка не на виду. На видимой вкладке своё окно
// поверх графика — это раздражение, а не забота: там уже есть тост.
//
// Настройка живёт в localStorage, как язык, часовой пояс и напоминания
// экономкалендаря (см. lib/econcalAlerts.ts): разрешение на уведомления
// браузер и так выдаёт устройству, а не аккаунту.
const STORAGE_KEY = "ts_game_notify";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationsEnabled(): boolean {
  if (!notificationsSupported()) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1" && Notification.permission === "granted";
  } catch {
    return false;
  }
}

/**
 * Включить уведомления. Спрашивает разрешение — вызывать только из обработчика
 * клика: без жеста пользователя браузеры запрос отклоняют.
 */
export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  try {
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") return false;
    localStorage.setItem(STORAGE_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export function disableNotifications(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Приватный режим или запрет на хранилище — просто ничего не запоминаем.
  }
}

/**
 * Показать уведомление, если вкладка не на виду.
 *
 * `tag` схлопывает однотипные события в одно окно: на скальпинге за минуту
 * может закрыться десяток сделок, и десять окон подряд — это не
 * информирование, а атака.
 */
export function notifyIfHidden(title: string, body: string, tag = "game"): void {
  if (!notificationsEnabled()) return;
  if (typeof document === "undefined" || !document.hidden) return;
  try {
    new Notification(title, { body, tag, silent: true });
  } catch {
    // На некоторых платформах конструктор запрещён (нужен ServiceWorker) —
    // молча пропускаем: уведомление не то, ради чего стоит падать.
  }
}
