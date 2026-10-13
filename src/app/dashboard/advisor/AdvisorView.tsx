"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Download,
  ShieldCheck,
  CloudUpload,
  LayoutGrid,
  Crosshair,
  Scissors,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

// Страница советника TradeGridPanel: описание, скриншоты, установка и скачивание.
// Открывается из окна «Советник» в карточке MT5-аккаунта (dashboard/accounts).
//
// Файл лежит в downloads/ в корне репозитория (НЕ в public: скачивать можно
// только зарегистрированным, см. /api/advisor/download) и обновляется вручную:
// после правок советника (репозиторий SiarheyB/mt5_experts) — перекомпилировать
// в MetaEditor и загрузить TradeGridPanel.ex5 в /admin/downloads (там же номер версии).
const ADVISOR_FILE = "/api/advisor/download";

// Скриншоты из public/advisor. wide — весь график терминала, на всю ширину.
type Shot = { src: string; ru: string; en: string; wide?: boolean };
const SCREENS: Shot[] = [
  {
    src: "/advisor/order.webp",
    wide: true,
    ru: "Вкладка ОРДЕР: линии входа, SL и TP на графике, лот от риска, убыток, прибыль и R:R до отправки",
    en: "ORDER tab: entry, SL and TP lines on the chart, lot from risk, loss, profit and R:R before sending",
  },
  {
    src: "/advisor/grid.webp",
    wide: true,
    ru: "Вкладка СЕТКА: пять заявок между двумя ценами с общим риском, SL и TP",
    en: "GRID tab: five orders between two prices with a shared risk, SL and TP",
  },
  {
    src: "/advisor/order-panel.png",
    ru: "Панель крупно: настройка SELL-ордера",
    en: "Panel close-up: setting up a SELL order",
  },
  {
    src: "/advisor/grid-panel.png",
    ru: "Панель крупно: SELL-сетка, убыток и прибыль по всем заявкам",
    en: "Panel close-up: SELL grid with total loss and profit",
  },
  {
    src: "/advisor/upload.png",
    ru: "Выгрузка: под ссылкой tradingstat.ru — «Выгрузить отчёт», «АВТО» и строка «Сайт: подключено»",
    en: "Upload: under the tradingstat.ru link — «Upload report», «AUTO» and the «Site: connected» line",
  },
];
// Скриншоты к шагам установки/подключения.
const SHOT_WEBREQUEST: Shot = {
  src: "/advisor/webrequest.png",
  ru: "Сервис → Настройки → Советники: адрес в списке WebRequest",
  en: "Tools → Options → Expert Advisors: the address in the WebRequest list",
};
const SHOT_INPUTS: Shot = {
  src: "/advisor/inputs.png",
  ru: "Свойства советника (F7) → Входные параметры → группа tradingstat.ru",
  en: "Advisor properties (F7) → Inputs → tradingstat.ru group",
};

function Screenshot({ shot, ru, className = "" }: { shot: Shot; ru: boolean; className?: string }) {
  const caption = ru ? shot.ru : shot.en;
  return (
    <figure className={className}>
      <a href={shot.src} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element -- статичный скриншот из public, оптимизация не нужна */}
        <img src={shot.src} alt={caption} className="w-full h-auto rounded-md border border-border" loading="lazy" />
      </a>
      <figcaption className="text-xs text-muted mt-2">{caption}</figcaption>
    </figure>
  );
}

type Content = {
  back: string;
  title: string;
  lead: string;
  mt5only: string;
  download: string;
  version: string;
  registerToDownload: string;
  register: string;
  featuresTitle: string;
  features: { icon: typeof LayoutGrid; title: string; text: string }[];
  screensTitle: string;
  installTitle: string;
  install: { title: string; text: string; code?: string; shot?: Shot }[];
  connectTitle: string;
  connect: string[];
  panelTitle: string;
  panel: { title: string; text: string }[];
  faqTitle: string;
  faq: { q: string; a: string }[];
  safety: string;
};

const RU: Content = {
  back: "К биржам",
  title: "Советник TradeGridPanel для MetaTrader 5",
  lead:
    "Торговая панель прямо на графике: рыночные и отложенные ордера с расчётом лота от риска, сетка заявок, безубыток и частичное закрытие. Советник сам ничего не торгует — только по вашим кнопкам — и умеет выгружать закрытые сделки в TradeStats.",
  mt5only: "Только MetaTrader 5. Для MT4 используйте импорт HTML-отчёта.",
  download: "Скачать советник",
  version: "Версия",
  registerToDownload: "Скачать советник могут только зарегистрированные пользователи.",
  register: "Создать аккаунт",
  featuresTitle: "Что умеет",
  features: [
    {
      icon: Crosshair,
      title: "Ордера с линиями на графике",
      text: "Buy/Sell, Stop и Limit. Вход, SL и TP — линиями, которые тянутся мышью. Лот считается от риска в валюте счёта, R:R и убыток видны до отправки.",
    },
    {
      icon: LayoutGrid,
      title: "Сетка заявок",
      text: "Серия отложенных ордеров между двумя ценами с общим риском. Если минимальный лот не вписывается в риск — панель подсветит это красным.",
    },
    {
      icon: Scissors,
      title: "Управление позициями",
      text: "Перенос SL в безубыток, общий TP, частичное закрытие выбранной позиции или самой убыточной, удаление отложек, закрытие всех сделок.",
    },
    {
      icon: CloudUpload,
      title: "Выгрузка в TradeStats",
      text: "Кнопка «Выгрузить отчёт» отправляет историю счёта в этот аккаунт, а режим «АВТО» — после каждого закрытия. Дубликатов не будет: сделки сверяются по тикету.",
    },
  ],
  screensTitle: "Как выглядит",
  installTitle: "Установка",
  install: [
    {
      title: "Скачайте файл советника",
      text: "Кнопка «Скачать советник» вверху страницы — файл TradeGridPanel.ex5.",
    },
    {
      title: "Положите его в папку советников",
      text: "В MetaTrader 5: «Файл» → «Открыть каталог данных» → папка MQL5 → Experts. Скопируйте туда файл, затем в «Навигаторе» нажмите правой кнопкой на «Советники» → «Обновить».",
      code: "MQL5\\Experts\\TradeGridPanel.ex5",
    },
    {
      title: "Разрешите алготорговлю",
      text: "Кнопка «Алготрейдинг» на верхней панели терминала должна быть зелёной. При установке на график, на вкладке «Общие», отметьте «Разрешить алгоритмическую торговлю».",
    },
    {
      title: "Разрешите адрес сайта для выгрузки",
      text: "«Сервис» → «Настройки» → «Советники» → отметьте «Разрешить WebRequest для следующих URL», добавьте адрес и нажмите Enter, затем OK.",
      code: "https://tradingstat.ru",
      shot: SHOT_WEBREQUEST,
    },
    {
      title: "Перетащите советник на график",
      text: "Из «Навигатора» → «Советники» на график нужного инструмента. Панель появится в левом верхнем углу.",
    },
  ],
  connectTitle: "Подключение к TradeStats",
  connect: [
    "В разделе «Биржи» у MT5-аккаунта нажмите «Советник» → «Создать токен» и скопируйте его. Токен показывается один раз.",
    "В терминале откройте свойства советника (F7) → «Входные параметры» → группа tradingstat.ru и вставьте токен в поле «Токен аккаунта с сайта».",
    "Нажмите на панели «Выгрузить отчёт». В статусе появится «Новых N, обновлено N», а в строке «Сайт: подключено». Сделки сразу видны в разделе «Сделки».",
    "Включите «АВТО», чтобы история выгружалась сама после каждого закрытия позиции, в том числе частичного.",
  ],
  panelTitle: "Панель по разделам",
  panel: [
    {
      title: "Вкладка ОРДЕР",
      text: "Поля ЛОТ, РИСК и КОММЕНТ. Выберите тип ордера — на графике появятся линии входа, SL и TP. Двигайте их мышью или стрелками ▲▼ и нажмите «ОТПРАВИТЬ». При РИСК > 0 лот рассчитывается так, чтобы убыток по SL равнялся этой сумме.",
    },
    {
      title: "Вкладка СЕТКА",
      text: "Задайте общий риск и число заявок, нажмите BUY или SELL СЕТКА и кликните по графику: начало, конец сетки, SL, TP. «РАЗМЕСТИТЬ» отправит все заявки, риск делится между ними.",
    },
    {
      title: "Безубыток и TP",
      text: "«SL → безубыток» переносит стоп в точку входа у позиций с прибылью не меньше заданной. «Задать TP всем» ставит один TP на все позиции и отложки советника.",
    },
    {
      title: "Частичное закрытие",
      text: "Кнопка «Позиция» выбирает, что закрывать: конкретный тикет или режим «ВСЕ» — тогда объём закрывается на стороне с большим объёмом, начиная с самой убыточной позиции.",
    },
    {
      title: "Выгрузка",
      text: "Под ссылкой tradingstat.ru: «Выгрузить отчёт», переключатель «АВТО» и строка «Сайт: …» с временем последней выгрузки или причиной ошибки.",
    },
  ],
  faqTitle: "Частые ошибки",
  faq: [
    {
      q: "«Адрес не разрешён» (ошибка 4014)",
      a: "Адрес сайта не добавлен в список WebRequest: «Сервис» → «Настройки» → «Советники». Строку нужно подтвердить клавишей Enter, затем нажать OK.",
    },
    {
      q: "«Токен не принят»",
      a: "Токен неверный или его отозвали. Создайте новый в окне «Советник» и замените в настройках советника.",
    },
    {
      q: "10027 — «AutoTrading disabled by client»",
      a: "Выключена кнопка «Алготрейдинг» или не стоит галка «Разрешить алгоритмическую торговлю» в свойствах советника.",
    },
    {
      q: "Сделки задвоятся, если загружать и отчётом, и советником?",
      a: "Нет. Оба способа сверяют сделки по тикету позиции: повторы пропускаются, дозакрытые позиции обновляются.",
    },
  ],
  safety:
    "Токен даёт только одно право — загружать сделки в этот аккаунт. Он ничего не читает с сайта и не торгует. Не публикуйте его; если он засветился — нажмите «Новый токен», и старый перестанет работать.",
};

const EN: Content = {
  back: "Back to exchanges",
  title: "TradeGridPanel advisor for MetaTrader 5",
  lead:
    "A trading panel right on the chart: market and pending orders sized from risk, order grids, breakeven and partial close. The advisor never trades on its own — only on your clicks — and can upload closed trades to TradeStats.",
  mt5only: "MetaTrader 5 only. For MT4, use the HTML report import.",
  download: "Download advisor",
  version: "Version",
  registerToDownload: "Only registered users can download the advisor.",
  register: "Create account",
  featuresTitle: "Features",
  features: [
    {
      icon: Crosshair,
      title: "Orders with chart lines",
      text: "Buy/Sell, Stop and Limit. Entry, SL and TP are draggable lines. Lot size is derived from risk in account currency; R:R and loss are shown before sending.",
    },
    {
      icon: LayoutGrid,
      title: "Order grid",
      text: "A series of pending orders between two prices with a shared risk. If the minimum lot can't fit the risk, the panel highlights it in red.",
    },
    {
      icon: Scissors,
      title: "Position management",
      text: "Move SL to breakeven, set a common TP, partially close a chosen or the worst position, delete pending orders, close everything.",
    },
    {
      icon: CloudUpload,
      title: "Upload to TradeStats",
      text: "«Upload report» sends the account history to this account, «AUTO» does it after every close. No duplicates: trades are matched by ticket.",
    },
  ],
  screensTitle: "Screenshots",
  installTitle: "Installation",
  install: [
    { title: "Download the file", text: "Use «Download advisor» above — TradeGridPanel.ex5." },
    {
      title: "Put it into the Experts folder",
      text: "In MetaTrader 5: File → Open Data Folder → MQL5 → Experts. Copy the file there, then in the Navigator right-click Expert Advisors → Refresh.",
      code: "MQL5\\Experts\\TradeGridPanel.ex5",
    },
    {
      title: "Allow algo trading",
      text: "The «Algo Trading» toolbar button must be green. When attaching to a chart, tick «Allow Algo Trading» on the Common tab.",
    },
    {
      title: "Allow the site address",
      text: "Tools → Options → Expert Advisors → tick «Allow WebRequest for listed URL», add the address, press Enter, then OK.",
      code: "https://tradingstat.ru",
      shot: SHOT_WEBREQUEST,
    },
    { title: "Attach to a chart", text: "Drag it from Navigator → Expert Advisors onto a chart. The panel appears in the top-left corner." },
  ],
  connectTitle: "Connecting to TradeStats",
  connect: [
    "In Exchanges, on your MT5 account click «Advisor» → «Create token» and copy it. It is shown only once.",
    "In the terminal open the advisor properties (F7) → Inputs → tradingstat.ru group and paste the token.",
    "Click «Upload report» on the panel. The status shows «New N, updated N» and the line «Site: connected». Trades appear in Trades right away.",
    "Turn on «AUTO» to upload after every close, partial closes included.",
  ],
  panelTitle: "Panel guide",
  panel: [
    { title: "ORDER tab", text: "LOT, RISK and COMMENT fields. Pick an order type, adjust the entry/SL/TP lines and press SEND. With RISK > 0 the lot is sized so the loss at SL equals that amount." },
    { title: "GRID tab", text: "Set the total risk and the number of orders, press BUY or SELL GRID and click the chart: start, end, SL, TP. PLACE sends all orders, splitting the risk." },
    { title: "Breakeven and TP", text: "«SL → breakeven» moves the stop to entry for positions with enough profit. «Set TP for all» applies one TP to all the advisor's positions and orders." },
    { title: "Partial close", text: "The «Position» button picks what to close: a specific ticket, or ALL — then the volume is closed on the larger side, worst position first." },
    { title: "Upload", text: "Under the tradingstat.ru link: «Upload report», the «AUTO» toggle and the «Site: …» line with the last upload time or the error." },
  ],
  faqTitle: "Common errors",
  faq: [
    { q: "«Address not allowed» (error 4014)", a: "The site address isn't in the WebRequest list: Tools → Options → Expert Advisors. Confirm the row with Enter, then OK." },
    { q: "«Token rejected»", a: "The token is wrong or revoked. Create a new one in the «Advisor» window and update the advisor settings." },
    { q: "10027 — «AutoTrading disabled by client»", a: "The «Algo Trading» button is off, or «Allow Algo Trading» isn't ticked in the advisor properties." },
    { q: "Will trades duplicate if I use both the report and the advisor?", a: "No. Both match trades by position ticket: repeats are skipped, partially closed positions are updated." },
  ],
  safety:
    "The token grants one right only — uploading trades into this account. It can't read anything or trade. Don't share it; if it leaks, click «New token» and the old one stops working.",
};

export default function AdvisorView({ canDownload, version }: { canDownload: boolean; version: string }) {
  const { locale } = useI18n();
  const ru = locale === "ru";
  const c = ru ? RU : EN;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-8">
      <Link href="/dashboard/accounts" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft size={16} />
        {c.back}
      </Link>

      <section className="card p-6">
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="text-muted mt-3 leading-relaxed">{c.lead}</p>
        <div className="flex flex-wrap items-center gap-3 mt-5">
          {canDownload ? (
            <a
              href={ADVISOR_FILE}
              download
              rel="nofollow"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90"
            >
              <Download size={16} />
              {c.download}
            </a>
          ) : (
            <>
              <span className="text-sm text-muted">{c.registerToDownload}</span>
              <Link
                href="/register"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90"
              >
                {c.register}
              </Link>
            </>
          )}
          <span className="text-sm text-faint">
            TradeGridPanel.ex5 · {c.version} {version}
          </span>
        </div>
        <p className="text-xs text-warn mt-3">{c.mt5only}</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">{c.featuresTitle}</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {c.features.map((f) => (
            <div key={f.title} className="card p-4">
              <div className="flex items-center gap-2 font-medium">
                <f.icon size={16} className="text-accent" />
                {f.title}
              </div>
              <p className="text-sm text-muted mt-2 leading-relaxed">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {SCREENS.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">{c.screensTitle}</h2>
          <div className="space-y-4">
            {SCREENS.filter((s) => s.wide).map((s) => (
              <Screenshot key={s.src} shot={s} ru={ru} className="card p-3" />
            ))}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
              {SCREENS.filter((s) => !s.wide).map((s) => (
                <Screenshot key={s.src} shot={s} ru={ru} className="card p-3" />
              ))}
            </div>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">{c.installTitle}</h2>
        <ol className="space-y-3">
          {c.install.map((s, i) => (
            <li key={s.title} className="card p-4 flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-accent/15 text-accent text-xs font-semibold flex items-center justify-center">
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="font-medium">{s.title}</div>
                <p className="text-sm text-muted mt-1 leading-relaxed">{s.text}</p>
                {s.code && (
                  <code className="inline-block mt-2 px-2 py-1 rounded bg-surface-2 text-xs font-mono break-all">{s.code}</code>
                )}
                {s.shot && <Screenshot shot={s.shot} ru={ru} className="mt-3 max-w-md" />}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">{c.connectTitle}</h2>
        <div className="card p-4 space-y-3">
          {c.connect.map((s, i) => (
            <div key={s}>
              <div className="flex gap-2 text-sm leading-relaxed">
                <CheckCircle2 size={16} className="text-accent shrink-0 mt-0.5" />
                <span>{s}</span>
              </div>
              {/* второй шаг — вставить токен в свойства советника */}
              {i === 1 && <Screenshot shot={SHOT_INPUTS} ru={ru} className="mt-3 ml-6 max-w-xl" />}
            </div>
          ))}
          <div className="flex gap-2 text-xs text-muted pt-2 border-t border-border">
            <ShieldCheck size={14} className="shrink-0 mt-0.5" />
            <span>{c.safety}</span>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">{c.panelTitle}</h2>
        <div className="card divide-y divide-border">
          {c.panel.map((p) => (
            <div key={p.title} className="p-4">
              <div className="font-medium">{p.title}</div>
              <p className="text-sm text-muted mt-1 leading-relaxed">{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">{c.faqTitle}</h2>
        <div className="space-y-2">
          {c.faq.map((f) => (
            <details key={f.q} className="card p-4 group">
              <summary className="cursor-pointer font-medium flex items-center gap-2">
                <AlertTriangle size={14} className="text-warn shrink-0" />
                {f.q}
              </summary>
              <p className="text-sm text-muted mt-2 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
