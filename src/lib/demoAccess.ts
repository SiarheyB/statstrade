/**
 * demoAccess.ts — что закрыто в демо-режиме.
 *
 * Демо показывает работу с торговым дневником: обзор, аналитику, сделки,
 * календарь и новости. Всё остальное закрыто, и по разным причинам:
 *
 *  - настройки (включая биржи и настройки сделок) — там живут вещи, которые
 *    гость менял бы ОБЩЕМУ аккаунту, а часть из них (язык, таймзона) хранится
 *    в cookie браузера и после выхода из демо утекала бы в личный аккаунт
 *    того же человека;
 *  - «сервис» (карта ордеров, карта ликвидаций, рекомендации, форекс, риск) —
 *    тяжёлые разделы поверх живых рыночных данных, не про демо-дневник;
 *  - плейбуки, поддержка, уведомления, админка — личная переписка и записи,
 *    общий аккаунт не место для них.
 *
 * Один список на всех: middleware закрывает прямой заход по адресу, меню по
 * нему же прячет пункты. Так «спрятали в меню, но забыли закрыть роут» не
 * случается — забыть можно только в одном месте.
 *
 * Модуль обязан оставаться без зависимостей: его импортирует middleware,
 * который работает в edge-рантайме.
 */

/** Страницы, закрытые для демо-сессии. */
export const DEMO_BLOCKED_PAGES = [
  "/admin",
  "/dashboard/settings",
  "/dashboard/accounts",
  "/dashboard/playbooks",
  "/dashboard/liqmap",
  "/dashboard/orderflow",
  "/dashboard/recommendations",
  "/dashboard/forex",
] as const;

/**
 * API этих же разделов. Закрываем и чтение: запрет на изменения (см.
 * middleware) не мешает демо-сессии выкачивать GET-ом стакан и рекомендации,
 * а раздел в интерфейсе при этом закрыт.
 */
export const DEMO_BLOCKED_API = [
  "/api/admin",
  "/api/support",
  "/api/notifications",
  "/api/playbooks",
  "/api/liqmap",
  "/api/orderflow",
  "/api/recommendations",
  "/api/forex",
] as const;

function matches(pathname: string, prefixes: readonly string[]): boolean {
  // Точное совпадение или вложенный путь: "/dashboard/settings" и
  // "/dashboard/settings/risk" — да, "/dashboard/settingsX" — нет.
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Закрыт ли этот путь для демо-сессии (страница или API). */
export function isDemoBlocked(pathname: string): boolean {
  return matches(pathname, DEMO_BLOCKED_PAGES) || matches(pathname, DEMO_BLOCKED_API);
}
