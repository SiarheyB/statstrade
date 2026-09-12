"use client";

/**
 * Браузерная сторона web push: регистрация service worker, подписка и отписка.
 *
 * Всё, что тут есть, работает только в защищённом контексте (https или
 * localhost) и только там, где браузер вообще умеет push — на iOS, например,
 * это возможно лишь для сайта, добавленного на домашний экран. Поэтому ни одна
 * функция не бросает исключение на отсутствие API: вызывающий UI просто
 * показывает «браузер не поддерживает уведомления».
 */

export type PushState =
  /** Браузер не умеет push (или контекст не защищённый). */
  | "unsupported"
  /** Сервер без VAPID-ключей — подписываться некуда. */
  | "unconfigured"
  /** Человек запретил уведомления в браузере; вернуть можно только в настройках сайта. */
  | "denied"
  /** Всё готово, но подписки нет. */
  | "off"
  /** Подписка есть. */
  | "on";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * VAPID-ключ приходит с сервера в base64url, а PushManager.subscribe требует
 * Uint8Array. Ручное декодирование, потому что atob не знает про base64url
 * (там `-` и `_` вместо `+` и `/`).
 */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  try {
    // register() идемпотентен: повторный вызов с тем же адресом возвращает
    // уже зарегистрированный воркер, а не заводит второй.
    const reg = await navigator.serviceWorker.register("/sw.js");
    // Подписываться можно только у активного воркера — сразу после первой
    // регистрации он ещё installing.
    await navigator.serviceWorker.ready;
    return reg;
  } catch {
    return null;
  }
}

/** Текущее состояние, без единого запроса разрешений у пользователя. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const res = await fetch("/api/push/subscribe");
  if (!res.ok) return "unconfigured";
  const { publicKey } = (await res.json()) as { publicKey: string | null };
  if (!publicKey) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  if (!reg) return "unsupported";
  const sub = await reg.pushManager.getSubscription();
  return sub ? "on" : "off";
}

/**
 * Подписать этот браузер. Возвращает новое состояние — вызывающий UI по нему
 * рисует результат, включая отказ в разрешении.
 */
export async function subscribePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const res = await fetch("/api/push/subscribe");
  if (!res.ok) return "unconfigured";
  const { publicKey } = (await res.json()) as { publicKey: string | null };
  if (!publicKey) return "unconfigured";

  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  const reg = await registration();
  if (!reg) return "unsupported";

  // Существующая подписка могла остаться от ПРЕДЫДУЩЕЙ пары VAPID-ключей — с
  // ней сервер получил бы 403 на каждой отправке. Дешевле пересоздать её здесь,
  // чем ловить мёртвую подписку в рассылке.
  const existing = await reg.pushManager.getSubscription();
  if (existing) await existing.unsubscribe().catch(() => {});

  let sub: PushSubscription;
  try {
    sub = await reg.pushManager.subscribe({
      // userVisibleOnly обязателен в Chrome: браузер разрешает push только с
      // обещанием, что каждое сообщение станет видимым уведомлением.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  } catch {
    return "off";
  }

  const ok = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  }).then((r) => r.ok);
  // Не сохранилось на сервере — снимаем и подписку в браузере, иначе человек
  // видел бы включённый тумблер, на который никто никогда ничего не пришлёт.
  if (!ok) {
    await sub.unsubscribe().catch(() => {});
    return "off";
  }
  return "on";
}

/**
 * Отправить на сервер копию настроек напоминаний о новостях с ЭТОГО
 * устройства — чтобы они приходили и при закрытой вкладке.
 *
 * Тихо ничего не делает, если push на устройстве не подключён: настройки
 * всё равно продолжают работать в открытой вкладке (EconCalAlerts), просто
 * серверу они в этом случае не нужны.
 */
export async function syncEconcalPrefs(settings: unknown): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await registration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    await fetch("/api/push/subscribe", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint, econcal: settings }),
    });
  } catch {
    // Копия настроек — удобство, а не условие работы: в открытой вкладке
    // напоминания работают и без неё.
  }
}

/** Отписать этот браузер (в БД и в самом браузере). */
export async function unsubscribePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub?.endpoint ?? "" }),
  }).catch(() => {});
  if (sub) await sub.unsubscribe().catch(() => {});
  return "off";
}
