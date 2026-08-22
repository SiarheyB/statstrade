// Метаданные страниц для поисковиков и мессенджеров.
//
// Зачем отдельный модуль: до него метаданные были только в корневом layout —
// один заголовок и одно описание на весь сайт. Публичные /news и /calendar
// наследовали их, то есть в выдаче выглядели дублями главной, ссылка в
// Telegram разворачивалась голой (нет Open Graph), а canonical не было вовсе.
//
// Абсолютные URL строятся от siteUrl() — адрес приходит из заголовков запроса,
// поэтому метаданные обязаны считаться на запросе (страницы уже динамические).

import type { Metadata } from "next";
import { siteUrl } from "@/lib/siteUrl";
import type { Locale } from "@/lib/i18n/core";

export type SeoPage = {
  /** Путь без хоста, с ведущим слэшем: "/", "/news". */
  path: string;
  title: Record<Locale, string>;
  description: Record<Locale, string>;
};

export const SEO_PAGES = {
  home: {
    path: "/",
    title: {
      ru: "TradeStats — статистика трейдера и уровни на день",
      en: "TradeStats — trader statistics and daily levels",
    },
    description: {
      ru: "Статистика сделок с Binance, Bybit и OKX по API, разбор дневных уровней, экономический календарь и лента новостей рынка.",
      en: "Trade statistics from Binance, Bybit and OKX via API, daily level analysis, economic calendar and market news.",
    },
  },
  news: {
    path: "/news",
    title: {
      ru: "Новости крипторынка — лента TradeStats",
      en: "Crypto market news — TradeStats feed",
    },
    description: {
      ru: "Лента новостей крипторынка: обновляется каждый час, без регистрации.",
      en: "Crypto market news feed, updated hourly, no sign-up required.",
    },
  },
  calendar: {
    path: "/calendar",
    title: {
      ru: "Экономический календарь трейдера — TradeStats",
      en: "Economic calendar for traders — TradeStats",
    },
    description: {
      ru: "Экономический календарь: события по дням, важность и ожидаемое влияние на рынок. Без регистрации.",
      en: "Economic calendar: events by day, importance and market impact. No sign-up required.",
    },
  },
  pricing: {
    path: "/pricing",
    title: {
      ru: "Тарифы TradeStats — сейчас бесплатно",
      en: "TradeStats pricing — free for now",
    },
    description: {
      ru: "Один тариф и он бесплатный: статистика сделок, разбор уровней, карта ордеров и риск-менеджер. Без карты и пробного периода.",
      en: "One plan and it is free: trade statistics, level scans, order flow and a risk manager. No card, no trial period.",
    },
  },
} satisfies Record<string, SeoPage>;

/**
 * Метаданные одной публичной страницы: title/description на активном языке,
 * canonical и Open Graph с абсолютными URL.
 *
 * hreflang сюда НЕ ставится намеренно: язык переключается cookie при одном и
 * том же URL, то есть отдельного адреса у второй языковой версии нет. Пока
 * страницы не разъедутся на /ru и /en, любой hreflang будет ложью.
 */
export async function pageMetadata(page: SeoPage, locale: Locale): Promise<Metadata> {
  const base = await siteUrl();
  const url = page.path === "/" ? base : `${base}${page.path}`;
  const title = page.title[locale];
  const description = page.description[locale];
  return {
    metadataBase: new URL(base),
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      siteName: "TradeStats",
      title,
      description,
      locale: locale === "ru" ? "ru_RU" : "en_US",
    },
    twitter: { card: "summary", title, description },
  };
}

/**
 * JSON-LD для главной: описывает сайт как продукт и даёт поисковику имя,
 * язык и назначение в машиночитаемом виде. Разметка помогает собрать
 * расширенный сниппет; без неё поисковик угадывает по тексту страницы.
 */
export async function siteJsonLd(locale: Locale): Promise<string> {
  const base = await siteUrl();
  const page = SEO_PAGES.home;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "TradeStats",
    url: base,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    inLanguage: locale === "ru" ? "ru-RU" : "en-US",
    description: page.description[locale],
    offers: { "@type": "Offer", price: "0", priceCurrency: "RUB" },
  });
}
