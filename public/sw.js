/* Service worker приложения — существует ради web push.
 *
 * Кэширования здесь НЕТ намеренно: приложение показывает биржевые данные, и
 * отдать их из кэша значит показать вчерашнюю цену как сегодняшнюю. Воркер
 * нужен только затем, что показать уведомление при ЗАКРЫТОЙ вкладке умеет
 * исключительно он — обычный JS страницы к этому моменту уже не выполняется.
 */

// Не ждать, пока закроются старые вкладки: иначе после деплоя новый воркер
// висит в waiting, а уведомления продолжает обрабатывать старый.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Чужой/битый payload — лучше показать заглушку, чем промолчать.
  }
  const title = data.title || "TradeStats";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // tag схлопывает повторы: второе уведомление по тому же уровню заменяет
      // первое, а не копится стопкой на экране телефона.
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    // Если вкладка приложения уже открыта — переводим фокус на неё и уводим
    // на нужный адрес, а не плодим второе окно с тем же сайтом.
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
