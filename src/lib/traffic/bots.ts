// Классификация «человек или робот» по User-Agent и заголовкам запроса.
//
// Зачем отдельный модуль: посещаемость без этой развязки бессмысленна — на
// публичный сайт с открытым HTTPS-туннелем львиная доля запросов приходит от
// поисковых краулеров, AI-скраперов и сканеров уязвимостей. Считать их вместе
// с людьми — значит смотреть на график, который ничего не говорит.
//
// Модуль ЧИСТЫЙ (без prisma/node-API): вызывается и из middleware (edge), и из
// API-роутов (node), и из тестов.

export type BotCategory =
  | "search" // поисковые роботы: Google, Yandex, Bing…
  | "ai" // сборщики данных для LLM: GPTBot, ClaudeBot, CCBot…
  | "seo" // SEO-краулеры: Ahrefs, Semrush, MJ12…
  | "social" // разворачивание ссылок в мессенджерах: Telegram, WhatsApp, VK…
  | "monitor" // аптайм-мониторинг: UptimeRobot, Pingdom…
  | "tool" // curl / python-requests / headless-браузеры
  | "scanner" // сканеры уязвимостей (лезут в /wp-login.php, /.env)
  | "other"; // сработало родовое правило (bot|crawler|spider), имя неизвестно

export type BotVerdict = {
  isBot: boolean;
  /** Человекочитаемое имя робота для таблицы в админке. */
  name: string | null;
  category: BotCategory | null;
  /** Почему так решили — видно в админке, помогает отлаживать эвристики. */
  reason: string | null;
};

const HUMAN: BotVerdict = { isBot: false, name: null, category: null, reason: null };

// Порядок важен: более специфичные правила выше родовых. Проверяется по
// User-Agent в нижнем регистре.
const RULES: { re: RegExp; name: string; category: BotCategory }[] = [
  // — поисковые
  { re: /googlebot|google-inspectiontool|storebot-google/, name: "Googlebot", category: "search" },
  { re: /bingbot|bingpreview|msnbot/, name: "Bingbot", category: "search" },
  { re: /yandexbot|yandeximages|yandexmetrika|yandexaccessibilitybot|yandex\.com\/bots/, name: "YandexBot", category: "search" },
  { re: /duckduckbot|duckduckgo/, name: "DuckDuckBot", category: "search" },
  { re: /baiduspider/, name: "Baiduspider", category: "search" },
  { re: /applebot/, name: "Applebot", category: "search" },
  { re: /seznambot/, name: "SeznamBot", category: "search" },
  { re: /mail\.ru_bot/, name: "Mail.ru bot", category: "search" },
  // — сборщики для LLM
  { re: /gptbot|chatgpt-user|oai-searchbot/, name: "GPTBot (OpenAI)", category: "ai" },
  { re: /claudebot|claude-web|anthropic-ai/, name: "ClaudeBot (Anthropic)", category: "ai" },
  { re: /perplexitybot|perplexity-user/, name: "PerplexityBot", category: "ai" },
  { re: /google-extended/, name: "Google-Extended (AI)", category: "ai" },
  { re: /ccbot/, name: "CCBot (Common Crawl)", category: "ai" },
  { re: /bytespider/, name: "Bytespider (TikTok)", category: "ai" },
  { re: /amazonbot/, name: "Amazonbot", category: "ai" },
  { re: /meta-externalagent|facebookbot/, name: "Meta AI crawler", category: "ai" },
  { re: /cohere-ai|diffbot|omgili|timpibot|imagesiftbot/, name: "AI-скрапер", category: "ai" },
  // — SEO / маркетинговые
  { re: /ahrefsbot|ahrefssiteaudit/, name: "AhrefsBot", category: "seo" },
  { re: /semrushbot|siteauditbot/, name: "SemrushBot", category: "seo" },
  { re: /mj12bot/, name: "MJ12bot", category: "seo" },
  { re: /dotbot|opensiteexplorer|rogerbot/, name: "DotBot (Moz)", category: "seo" },
  { re: /petalbot/, name: "PetalBot (Huawei)", category: "seo" },
  { re: /dataforseobot/, name: "DataForSeoBot", category: "seo" },
  { re: /blexbot|serpstatbot|barkrowler|zoominfobot|linkfluence/, name: "SEO-краулер", category: "seo" },
  // — превью ссылок в соцсетях и мессенджерах
  { re: /telegrambot/, name: "TelegramBot (превью)", category: "social" },
  { re: /whatsapp/, name: "WhatsApp (превью)", category: "social" },
  { re: /facebookexternalhit|facebookcatalog/, name: "Facebook (превью)", category: "social" },
  { re: /twitterbot/, name: "Twitterbot (превью)", category: "social" },
  { re: /vkshare|vkrobot/, name: "VK (превью)", category: "social" },
  { re: /discordbot/, name: "Discordbot (превью)", category: "social" },
  { re: /slackbot|slack-imgproxy/, name: "Slackbot (превью)", category: "social" },
  { re: /linkedinbot/, name: "LinkedInBot (превью)", category: "social" },
  { re: /redditbot|pinterest/, name: "Соцсеть (превью)", category: "social" },
  { re: /skypeuripreview|viber/, name: "Мессенджер (превью)", category: "social" },
  // — мониторинг доступности
  { re: /uptimerobot|pingdom|statuscake|betteruptime|site24x7|hetrixtools|newrelicpinger/, name: "Мониторинг аптайма", category: "monitor" },
  // — консольные клиенты и headless-браузеры
  // Electron сюда НЕ добавляем: под ним ходят и обычные люди (десктопные
  // приложения со встроенным браузером), а ошибочно записать человека в роботы
  // хуже, чем наоборот.
  { re: /headlesschrome|puppeteer|playwright|phantomjs|selenium/, name: "Headless-браузер", category: "tool" },
  { re: /curl\//, name: "curl", category: "tool" },
  { re: /wget/, name: "wget", category: "tool" },
  { re: /python-requests|python-urllib|aiohttp|httpx|scrapy/, name: "Python-скрипт", category: "tool" },
  { re: /go-http-client/, name: "Go HTTP client", category: "tool" },
  { re: /java\/|okhttp|apache-httpclient/, name: "Java HTTP client", category: "tool" },
  { re: /node-fetch|axios|got \(|libwww-perl|guzzlehttp|postman/, name: "HTTP-библиотека", category: "tool" },
  { re: /zgrab|masscan|nmap|nuclei|sqlmap|censysinspect|internetmeasurement|paloaltonetworks|expanse/, name: "Сканер сети", category: "scanner" },
  // — родовое правило последним
  { re: /\bbot\b|bot\/|bot;|crawler|crawl|spider|slurp|fetcher|scraper|archiver|feedfetcher|monitoring|checker|validator|preview/, name: "Неизвестный робот", category: "other" },
];

// Пути, по которым ходят только сканеры уязвимостей: у приложения таких
// маршрутов нет и не было. Совпадение — надёжный признак робота даже с
// «человеческим» User-Agent (сканеры подделывают его в первую очередь).
const SCANNER_PATHS =
  /^\/(wp-|wordpress|xmlrpc\.php|\.env|\.git|\.aws|\.ssh|phpmyadmin|pma|adminer|vendor\/|cgi-bin|owa\/|autodiscover|boaform|hnap1|solr|actuator|telescope|_ignition|config\.json|credentials|backup\.(sql|zip|tar))/i;

export function isScannerPath(path: string): boolean {
  return SCANNER_PATHS.test(path);
}

export type BotSignals = {
  userAgent: string | null;
  /** Заголовок Accept-Language: настоящие браузеры его почти всегда шлют. */
  acceptLanguage?: string | null;
  /** Sec-Fetch-Mode / Sec-Fetch-Site: есть у всех современных браузеров. */
  secFetchMode?: string | null;
  /** Путь запроса — для распознавания сканеров уязвимостей. */
  path?: string | null;
};

/**
 * Решение «робот или человек».
 *
 * Сначала явные подписи в User-Agent (надёжно), затем эвристики для тех, кто
 * маскируется. Эвристики намеренно консервативные: лучше посчитать робота
 * человеком, чем выбросить живого посетителя со старым браузером из
 * статистики. Окончательное подтверждение «это человек» даёт браузерный маячок
 * (см. TrafficBeacon) — он проставляет визиту jsConfirmed.
 */
export function detectBot(sig: BotSignals): BotVerdict {
  const ua = (sig.userAgent ?? "").trim();
  const path = sig.path ?? "";

  if (path && isScannerPath(path)) {
    return { isBot: true, name: "Сканер уязвимостей", category: "scanner", reason: "scanner-path" };
  }

  if (!ua) {
    // Пустой UA — так ходят только скрипты; у любого браузера он есть.
    return { isBot: true, name: "Без User-Agent", category: "tool", reason: "empty-ua" };
  }

  const low = ua.toLowerCase();
  for (const r of RULES) {
    if (r.re.test(low)) {
      return { isBot: true, name: r.name, category: r.category, reason: "ua-match" };
    }
  }

  // Дальше — «выглядит как браузер». Проверяем то, что подделывают реже.
  const looksLikeBrowser = /mozilla\/|opera\//.test(low);
  if (!looksLikeBrowser) {
    return { isBot: true, name: "Неизвестный клиент", category: "tool", reason: "non-browser-ua" };
  }

  // Ни Accept-Language, ни Sec-Fetch-* — так HTML-страницу не запрашивает ни
  // один настоящий браузер после 2020 года. Оба заголовка отсутствуют → бот.
  const noLang = !sig.acceptLanguage;
  const noSecFetch = sig.secFetchMode === null || sig.secFetchMode === undefined || sig.secFetchMode === "";
  if (noLang && noSecFetch) {
    return { isBot: true, name: "Робот под браузер", category: "other", reason: "no-browser-headers" };
  }

  return HUMAN;
}
