import type { Locale } from "./i18n/core";

// Перевод названий событий экономического календаря и пояснения к ним.
//
// Фид ForexFactory отдаёт названия только по-английски и строго по шаблону:
// [страна/орган] + [Core/Flash/Prelim/Final] + [показатель] + [период m/m,
// y/y, q/q]. Поэтому переводим не машинным переводчиком (он ломается ровно на
// этой лексике: Unemployment Claims → «Требования по безработице» вместо
// «Заявки на пособие»), а словарём терминов: быстро, офлайн, и формулировки
// те, которыми реально пользуются трейдеры.
//
// Незнакомый термин остаётся по-английски — деградация мягкая: часть строки
// переведена, часть нет, но ничего не ломается и не врёт.

// ─── Периоды (суффикс в конце названия) ───────────────────────────────────

const PERIODS: Record<string, string> = {
  "m/m": "м/м",
  "y/y": "г/г",
  "q/q": "кв/кв",
  "w/w": "н/н",
  "d/d": "д/д",
  "ytd/y": "с начала года",
  "3m/3m": "3м/3м",
  "3m/y": "3м/г",
  "q/q ann.": "кв/кв год.",
  "q/y": "кв/г",
  mom: "м/м",
  yoy: "г/г",
};

// ─── Словарь терминов ─────────────────────────────────────────────────────
//
// `explain` — пояснение для подсказки по наведению: что это за показатель и
// как его читать. Пишем для новичка, без жаргона, с указанием реакции рынка.

type Term = {
  en: string;
  ru: string;
  explain?: { ru: string; en: string };
};

const TERMS: Term[] = [
  // — Инфляция —
  {
    en: "Core CPI",
    ru: "базовый ИПЦ",
    explain: {
      ru: "Инфляция без учёта еды и топлива — их цены скачут сами по себе и мешают увидеть тренд. Главный показатель, на который смотрит центробанк. Выше прогноза → ставки держат высокими дольше → валюта обычно растёт.",
      en: "Inflation excluding food and fuel, whose prices swing on their own and hide the trend. The number central banks watch most. Above forecast → rates stay high longer → the currency usually strengthens.",
    },
  },
  {
    en: "CPI",
    ru: "ИПЦ",
    explain: {
      ru: "Насколько подорожала потребительская корзина — базовая мера инфляции. Выше прогноза → выше шанс, что ставку поднимут или продержат высокой → валюта обычно растёт, акции падают.",
      en: "How much the consumer basket got more expensive — the basic inflation gauge. Above forecast → higher odds of a hike or of rates staying high → the currency usually strengthens, stocks fall.",
    },
  },
  {
    en: "Core PPI",
    ru: "базовый ИЦП",
    explain: {
      ru: "Цены производителей без еды и энергии. Опережает потребительскую инфляцию: сначала дорожает у завода, через месяцы — на полке.",
      en: "Producer prices excluding food and energy. Leads consumer inflation: the factory pays more first, the shelf follows months later.",
    },
  },
  {
    en: "PPI",
    ru: "ИЦП",
    explain: {
      ru: "Цены, по которым продают производители. Ранний сигнал будущей инфляции для потребителя.",
      en: "Prices producers charge. An early signal of future consumer inflation.",
    },
  },
  { en: "WPI", ru: "индекс оптовых цен" },
  // Банк Канады считает три «очищенные» инфляции сразу; названия у них
  // собственные (Common/Trim/Median), поэтому оставляем маркер латиницей —
  // по-русски их всё равно называют так же.
  {
    en: "Common CPI",
    ru: "базовая инфляция Common",
    explain: {
      ru: "Одна из трёх «очищенных» мер инфляции Банка Канады: берёт то, что дорожает во всех категориях сразу. Самая медленная и самая показательная для тренда.",
      en: "One of the Bank of Canada's three core inflation measures: it keeps what is rising across all categories at once. The slowest and the most telling for the trend.",
    },
  },
  {
    en: "Trimmed CPI",
    ru: "базовая инфляция Trim",
    explain: {
      ru: "Мера Банка Канады: отбрасывает по 20% самых сильно подорожавших и подешевевших позиций и считает середину.",
      en: "A Bank of Canada measure: it drops the 20% biggest gainers and losers and averages what is left.",
    },
  },
  {
    en: "Median CPI",
    ru: "базовая инфляция Median",
    explain: {
      ru: "Мера Банка Канады: медианный рост цен по корзине — половина товаров дорожала быстрее, половина медленнее.",
      en: "A Bank of Canada measure: the median price change across the basket — half the items rose faster, half slower.",
    },
  },
  {
    en: "Core PCE Price Index",
    ru: "базовый ценовой индекс PCE",
    explain: {
      ru: "Инфляция, по которой ФРС официально меряет свою цель в 2%. Считается по фактическим расходам людей, поэтому ФРС верит ему больше, чем ИПЦ.",
      en: "The inflation gauge the Fed officially targets at 2%. Built from what people actually spend, which is why the Fed trusts it over CPI.",
    },
  },
  { en: "PCE Price Index", ru: "ценовой индекс PCE" },
  { en: "Import Prices", ru: "цены на импорт" },
  { en: "Export Prices", ru: "цены на экспорт" },
  { en: "GDP Price Index", ru: "дефлятор ВВП" },
  { en: "Unit Labor Costs", ru: "удельные издержки на труд" },
  {
    en: "Inflation Expectations",
    ru: "инфляционные ожидания",
    explain: {
      ru: "Какую инфляцию люди и рынок ждут в будущем. Центробанки боятся их роста едва ли не сильнее самой инфляции: ожидания заставляют требовать более высокие зарплаты и цены.",
      en: "The inflation people and markets expect ahead. Central banks fear rising expectations almost more than inflation itself: they push wages and prices up on their own.",
    },
  },

  // — Ставки и центробанки —
  {
    en: "Cash Rate",
    ru: "решение по ключевой ставке",
    explain: {
      ru: "Сама ставка центробанка. Одно из самых сильных событий для валюты: неожиданное решение двигает курс мгновенно и надолго.",
      en: "The central bank's policy rate itself. One of the strongest events for a currency: a surprise moves the rate instantly and lastingly.",
    },
  },
  { en: "Official Bank Rate", ru: "решение по ключевой ставке" },
  { en: "Main Refinancing Rate", ru: "решение по ставке рефинансирования" },
  { en: "Overnight Rate", ru: "решение по ставке овернайт" },
  {
    en: "Rate Statement",
    ru: "заявление по ставке",
    explain: {
      ru: "Текст решения по ставке: формулировки важнее самой цифры — по ним рынок угадывает следующие шаги центробанка.",
      en: "The text accompanying the rate decision: the wording matters more than the number — markets read the bank's next steps from it.",
    },
  },
  { en: "Monetary Policy Statement", ru: "заявление по денежной политике" },
  { en: "Monetary Policy Summary", ru: "итоги заседания по денежной политике" },
  { en: "Meeting Minutes", ru: "протокол заседания" },
  { en: "Summary of Opinions", ru: "сводка мнений" },
  { en: "Press Conference", ru: "пресс-конференция" },
  { en: "Economic Projections", ru: "экономические прогнозы" },

  // — Занятость —
  {
    en: "Non-Farm Employment Change",
    ru: "занятость вне сельского хозяйства, NFP",
    explain: {
      ru: "Сколько рабочих мест создала экономика США за месяц, без сельского хозяйства. Самая громкая макро-новость месяца: выходит в первую пятницу и двигает всё сразу — доллар, индексы, золото.",
      en: "How many jobs the US economy added last month, farming aside. The loudest macro release of the month: it lands on the first Friday and moves everything at once — the dollar, indices, gold.",
    },
  },
  {
    en: "Unemployment Claims",
    ru: "заявки на пособие по безработице",
    explain: {
      ru: "Сколько человек за неделю впервые обратились за пособием. Самый свежий индикатор рынка труда — выходит еженедельно. Рост заявок = рынок труда слабеет.",
      en: "How many people filed for unemployment benefits for the first time this week. The freshest labour-market gauge — it comes out weekly. Rising claims mean a weakening job market.",
    },
  },
  {
    en: "Unemployment Rate",
    ru: "уровень безработицы",
    explain: {
      ru: "Доля безработных среди тех, кто ищет работу. Реагирует медленно, но это одна из двух целей центробанка наравне с инфляцией.",
      en: "The share of jobseekers without work. Slow to react, but one of the central bank's two mandates alongside inflation.",
    },
  },
  { en: "Employment Change", ru: "изменение занятости" },
  { en: "Average Hourly Earnings", ru: "средняя почасовая оплата" },
  { en: "Average Earnings Index", ru: "индекс средних зарплат" },
  { en: "Claimant Count Change", ru: "число получателей пособий" },
  { en: "Job Openings", ru: "число открытых вакансий" },
  { en: "Job Cuts", ru: "объявленные сокращения рабочих мест" },
  { en: "Labor Cash Earnings", ru: "денежные доходы работников" },
  { en: "Participation Rate", ru: "доля экономически активного населения" },
  { en: "Mortgage Delinquencies", ru: "просрочки по ипотеке" },

  // — Экономический рост —
  {
    en: "GDP",
    ru: "ВВП",
    explain: {
      ru: "Общий размер экономики. Главная мера роста: два квартала подряд со снижением принято называть рецессией. Данные выходят с задержкой, поэтому рынок реагирует слабее, чем на инфляцию.",
      en: "The total size of the economy. The headline growth gauge: two quarters of decline is the common definition of a recession. It lags, so markets react less than to inflation.",
    },
  },
  { en: "Business Investment", ru: "инвестиции бизнеса" },
  { en: "Industrial Production", ru: "промышленное производство" },
  { en: "Manufacturing Production", ru: "производство в обрабатывающей промышленности" },
  { en: "Construction Output", ru: "объём строительства" },
  { en: "Index of Services", ru: "индекс сферы услуг" },
  { en: "Machine Tool Orders", ru: "заказы на станки" },
  { en: "Business Inventories", ru: "товарные запасы бизнеса" },
  { en: "Foreign Direct Investment", ru: "прямые иностранные инвестиции" },
  {
    en: "Fixed Asset Investment",
    ru: "инвестиции в основной капитал",
    explain: {
      ru: "Сколько Китай вкладывает в стройки, заводы и инфраструктуру. Главный рычаг, которым Пекин разгоняет экономику, — важен для сырья и валют Австралии с Новой Зеландией.",
      en: "How much China puts into construction, factories and infrastructure. Beijing's main lever for stimulating growth — it matters for commodities and the Aussie and Kiwi dollars.",
    },
  },
  { en: "Capacity Utilization Rate", ru: "загрузка производственных мощностей" },
  { en: "Core Durable Goods Orders", ru: "базовые заказы на товары длительного пользования" },
  {
    en: "Durable Goods Orders",
    ru: "заказы на товары длительного пользования",
    explain: {
      ru: "Заказы на технику, машины и оборудование — то, что покупают на годы. Бизнес делает такие заказы, когда уверен в будущем, поэтому показатель опережает спад.",
      en: "Orders for machinery, vehicles and equipment — things bought for years. Businesses order them when confident, so the number leads downturns.",
    },
  },
  { en: "Factory Orders", ru: "промышленные заказы" },
  { en: "Nonfarm Productivity", ru: "производительность вне сельского хозяйства" },
  { en: "Wholesale Inventories", ru: "запасы на оптовых складах" },

  // — Потребитель и торговля —
  {
    en: "Core Retail Sales",
    ru: "базовые розничные продажи",
    explain: {
      ru: "Розничные продажи без автомобилей — их покупают редко и крупно, из-за чего общая цифра прыгает. Показывает, тратят ли люди деньги на самом деле.",
      en: "Retail sales excluding cars — rare, large purchases that make the headline number jump. Shows whether people are actually spending.",
    },
  },
  {
    en: "Retail Sales",
    ru: "розничные продажи",
    explain: {
      ru: "Сколько люди потратили в магазинах за месяц. Потребление — большая часть экономики, поэтому показатель заметно двигает рынок.",
      en: "How much people spent in shops last month. Consumption is the bulk of the economy, so the number moves markets noticeably.",
    },
  },
  { en: "Retail Sales Monitor", ru: "мониторинг розничных продаж" },
  { en: "Wholesale Sales", ru: "оптовые продажи" },
  { en: "Manufacturing Sales", ru: "продажи в обрабатывающей промышленности" },
  { en: "Goods Trade Balance", ru: "торговый баланс по товарам" },
  {
    en: "Trade Balance",
    ru: "торговый баланс",
    explain: {
      ru: "Разница между экспортом и импортом. Профицит поддерживает валюту: за экспорт расплачиваются в ней.",
      en: "Exports minus imports. A surplus supports the currency: exports are paid for in it.",
    },
  },
  { en: "Current Account", ru: "счёт текущих операций" },
  { en: "Visitor Arrivals", ru: "въездной туризм" },
  { en: "Personal Spending", ru: "расходы населения" },
  { en: "Personal Income", ru: "доходы населения" },
  { en: "Consumer Credit", ru: "потребительское кредитование" },
  { en: "Consumer Spending", ru: "потребительские расходы" },
  { en: "Foreign Securities Purchases", ru: "покупки иностранных ценных бумаг" },
  {
    en: "TIC Long-Term Purchases",
    ru: "покупки долгосрочных ценных бумаг США иностранцами (TIC)",
    explain: {
      ru: "На сколько иностранцы за месяц купили американских облигаций и акций. Показывает спрос на долларовые активы: приток поддерживает доллар, отток — давит.",
      en: "How much US bonds and stocks foreigners bought over the month. A gauge of demand for dollar assets: inflows support the dollar, outflows weigh on it.",
    },
  },

  // — Жильё —
  { en: "Building Permits", ru: "разрешения на строительство" },
  { en: "Housing Starts", ru: "закладки новых домов" },
  { en: "Existing Home Sales", ru: "продажи домов на вторичном рынке" },
  { en: "New Home Sales", ru: "продажи новых домов" },
  { en: "House Price Balance", ru: "баланс цен на жильё" },
  { en: "House Price Index", ru: "индекс цен на жильё" },
  { en: "New Home Prices", ru: "цены на новое жильё" },
  { en: "Pending Home Sales", ru: "незавершённые сделки по продаже жилья" },
  { en: "Mortgage Applications", ru: "заявки на ипотеку" },
  {
    en: "NAHB Housing Market Index",
    ru: "индекс рынка жилья NAHB",
    explain: {
      ru: "Опрос американских застройщиков: как они оценивают спрос на новые дома. Выше 50 — настроены оптимистично. Опережает статистику по закладкам домов на месяц-два.",
      en: "A survey of US homebuilders on demand for new houses. Above 50 means optimism. It leads housing-starts data by a month or two.",
    },
  },

  // — Настроения и опросы —
  {
    en: "Manufacturing PMI",
    ru: "PMI в промышленности",
    explain: {
      ru: "Опрос закупщиков на заводах. Выше 50 — отрасль растёт, ниже 50 — сжимается. Ценен тем, что выходит раньше официальной статистики.",
      en: "A survey of factory purchasing managers. Above 50 means the sector is growing, below 50 shrinking. Valuable because it lands before official statistics.",
    },
  },
  {
    en: "Services PMI",
    ru: "PMI в услугах",
    explain: {
      ru: "То же, что промышленный PMI, но по сфере услуг — а она в развитых экономиках больше промышленности. Выше 50 — рост, ниже — спад.",
      en: "The manufacturing PMI's counterpart for services — the larger sector in developed economies. Above 50 growth, below 50 contraction.",
    },
  },
  { en: "Composite PMI", ru: "сводный PMI" },
  { en: "Construction PMI", ru: "PMI в строительстве" },
  { en: "PMI", ru: "индекс деловой активности PMI" },
  {
    en: "Empire State Manufacturing Index",
    ru: "индекс промышленной активности ФРБ Нью-Йорка (Empire State)",
    explain: {
      ru: "Опрос заводов штата Нью-Йорк. Выходит одним из первых в месяце, поэтому по нему угадывают, каким будет общенациональный ISM. Выше нуля — производство растёт.",
      en: "A survey of New York State factories. One of the month's first releases, so markets read the national ISM from it. Above zero means manufacturing is expanding.",
    },
  },
  { en: "Philly Fed Manufacturing Index", ru: "индекс промышленной активности ФРБ Филадельфии" },
  { en: "Richmond Manufacturing Index", ru: "индекс промышленной активности ФРБ Ричмонда" },
  { en: "Manufacturing Index", ru: "индекс промышленной активности" },
  { en: "Consumer Sentiment", ru: "индекс потребительских настроений" },
  { en: "Consumer Confidence", ru: "индекс доверия потребителей" },
  { en: "Business Confidence", ru: "индекс делового доверия" },
  { en: "Investor Confidence", ru: "индекс доверия инвесторов" },
  { en: "Economy Watchers Sentiment", ru: "индекс настроений наблюдателей за экономикой" },
  { en: "Small Business Index", ru: "индекс настроений малого бизнеса" },
  { en: "Leading Index", ru: "индекс опережающих индикаторов" },
  { en: "Services Index", ru: "индекс активности в услугах" },
  { en: "Tertiary Industry Activity", ru: "активность в сфере услуг" },
  { en: "FPI", ru: "индекс цен на продукты питания" },
  { en: "Rightmove HPI", ru: "индекс цен предложения на жильё Rightmove" },

  // — Деньги, бюджет, аукционы —
  { en: "M2 Money Stock", ru: "денежная масса M2" },
  { en: "M2 Money Supply", ru: "денежная масса M2" },
  { en: "Bank Lending", ru: "банковское кредитование" },
  { en: "New Loans", ru: "объём новых кредитов" },
  { en: "Federal Budget Balance", ru: "баланс федерального бюджета" },
  { en: "Bond Auction", ru: "аукцион гособлигаций" },
  { en: "Beige Book", ru: "«Бежевая книга» ФРС" },
  { en: "Loan Prime Rate", ru: "базовая ставка по кредитам (LPR)" },

  // — Сырьё —
  {
    en: "Crude Oil Inventories",
    ru: "запасы сырой нефти",
    explain: {
      ru: "На сколько изменились запасы нефти в США за неделю. Запасы растут — спрос слабый, нефть обычно дешевеет; падают — наоборот.",
      en: "How US crude stockpiles changed over the week. Building inventories mean weak demand and usually cheaper oil; draws mean the opposite.",
    },
  },
  { en: "Natural Gas Storage", ru: "запасы природного газа" },
  { en: "Weekly Statistical Bulletin", ru: "еженедельный статистический бюллетень" },


  // — Добавлено по аудиту недельного среза фида: всё, что оставалось латиницей —
  { en: "Statement", ru: "заявление по итогам заседания" },
  { en: "Policy Rate", ru: "решение по ключевой ставке" },
  {
    en: "Federal Funds Rate",
    ru: "решение ФРС по ставке",
    explain: {
      ru: "Ставка ФРС — самое сильное событие месяца для доллара. Важна не только цифра, но и то, сколько голосов было против и как изменился прогноз по будущим ставкам.",
      en: "The Fed's policy rate — the strongest monthly event for the dollar. Not just the number: dissenting votes and the updated rate path matter as much.",
    },
  },
  { en: "Official Cash Rate", ru: "решение по ключевой ставке" },
  { en: "Deposit Facility Rate", ru: "ставка по депозитам ЕЦБ" },
  { en: "1-y Loan Prime Rate", ru: "базовая ставка по кредитам LPR, 1 год" },
  { en: "5-y Loan Prime Rate", ru: "базовая ставка по кредитам LPR, 5 лет — ориентир по ипотеке" },
  { en: "Monetary Policy Report", ru: "отчёт по денежной политике" },
  { en: "Economic Bulletin", ru: "экономический бюллетень" },
  { en: "Monthly Report", ru: "ежемесячный отчёт" },
  { en: "MPC Official Bank Rate Votes", ru: "распределение голосов MPC по ставке" },
  { en: "Business Outlook Survey", ru: "обзор деловых перспектив" },
  { en: "Bank Stress Test Results", ru: "результаты стресс-тестов банков" },

  // — Инфляция и цены —
  { en: "National Core CPI", ru: "базовый ИПЦ по стране" },
  { en: "Tokyo Core CPI", ru: "базовый ИПЦ Токио" },
  {
    en: "Trimmed Mean CPI",
    ru: "базовая инфляция, усечённое среднее",
    explain: {
      ru: "Инфляция, из которой выкинуты самые резкие подорожания и подешевения. Именно на неё смотрит Резервный банк Австралии, а не на общий ИПЦ.",
      en: "Inflation with the sharpest moves in both directions stripped out. This is what the Reserve Bank of Australia watches, not headline CPI.",
    },
  },
  { en: "RPI", ru: "индекс розничных цен" },
  { en: "PPI Input", ru: "закупочные цены производителей" },
  { en: "PPI Output", ru: "отпускные цены производителей" },
  { en: "IPPI", ru: "индекс цен производителей промышленной продукции" },
  { en: "RMPI", ru: "индекс цен на сырьё для промышленности" },
  { en: "Manufacturing Prices", ru: "индекс цен в промышленности" },
  { en: "Services Prices", ru: "индекс цен в услугах" },
  { en: "Commodity Prices", ru: "цены на сырьевой экспорт" },
  { en: "GDT Price Index", ru: "индекс цен на молочную продукцию, аукцион GDT" },
  { en: "Global Dairy Trade Price Index", ru: "индекс цен на молочную продукцию, аукцион GDT" },

  // — Занятость и зарплаты —
  { en: "Continuing Jobless Claims", ru: "повторные заявки на пособие по безработице" },
  { en: "Unemployment Change", ru: "изменение числа безработных" },
  {
    en: "Employment Cost Index",
    ru: "индекс стоимости рабочей силы",
    explain: {
      ru: "Насколько дорожает труд с учётом зарплат и льгот. ФРС смотрит на него как на источник «зарплатной» инфляции: растут зарплаты — растут и цены.",
      en: "How fast labour is getting more expensive, wages and benefits together. The Fed reads it as the source of wage-driven inflation.",
    },
  },
  { en: "Wage Price Index", ru: "индекс зарплат" },
  { en: "Household Spending", ru: "расходы домохозяйств" },
  { en: "Credit Card Spending", ru: "траты по кредитным картам" },

  // — Производство и капвложения —
  { en: "Core Machinery Orders", ru: "базовые заказы на машины и оборудование" },
  { en: "Private Capital Expenditure", ru: "частные капитальные вложения" },
  { en: "Non-Manufacturing Index", ru: "индекс активности вне промышленности" },
  { en: "Non-Manufacturing PMI", ru: "PMI вне промышленности" },
  { en: "Chicago PMI", ru: "PMI Чикаго" },
  { en: "Ivey PMI", ru: "PMI Ivey (Канада)" },
  { en: "Industrial Order Expectations", ru: "ожидания промышленных заказов" },
  { en: "Realized Sales", ru: "фактические продажи в рознице" },

  // — Настроения —
  { en: "Consumer Climate", ru: "индекс потребительского климата" },
  { en: "Business Climate", ru: "индекс делового климата" },
  {
    en: "Economic Sentiment",
    ru: "индекс экономических ожиданий",
    explain: {
      ru: "Опрос аналитиков и инвесторов: ждут они улучшения экономики через полгода или ухудшения. Выше нуля — оптимистов больше. Выходит раньше твёрдой статистики, поэтому рынок его слушает.",
      en: "A survey of analysts and investors on whether they expect the economy to improve over six months. Above zero means optimists dominate. It lands before hard data, so markets listen.",
    },
  },
  { en: "Economic Barometer", ru: "экономический барометр" },
  { en: "Economic Optimism", ru: "индекс экономического оптимизма" },

  // — Жильё, бюджет, прочее —
  { en: "HPI", ru: "индекс цен на жильё" },
  { en: "NHPI", ru: "индекс цен на новое жильё" },
  { en: "S&P/CS Composite-20 HPI", ru: "индекс цен на жильё S&P/Case-Shiller по 20 городам" },
  { en: "Building Approvals", ru: "одобренные заявки на строительство" },
  { en: "Building Consents", ru: "разрешения на строительство" },
  { en: "Public Sector Net Borrowing", ru: "чистые заимствования госсектора" },
  { en: "Redbook", ru: "розничные продажи Redbook" },
  { en: "Trade Balance USD", ru: "торговый баланс в долларах" },

  // — Прочее —
  { en: "Bank Holiday", ru: "выходной день, банки закрыты" },
  { en: "Weekly Employment Change", ru: "недельное изменение занятости" },
];

// ─── Модификаторы, страны, организации ────────────────────────────────────

// Уточнения перед показателем: Flash GDP, Prelim UoM Sentiment. Ставим их
// сокращением в хвост, а не прилагательным перед названием: иначе пришлось бы
// согласовывать род («предварительный ВВП», но «предварительная оценка»).
const MODIFIERS: Record<string, string> = {
  Flash: "предв.",
  Prelim: "предв.",
  Preliminary: "предв.",
  Advance: "предв.",
  Final: "оконч.",
  Revised: "перес.",
  Monthly: "за месяц",
  Weekly: "за неделю",
  Annual: "за год",
};

const COUNTRIES: Record<string, string> = {
  German: "Германия",
  French: "Франция",
  Italian: "Италия",
  Spanish: "Испания",
  Chinese: "Китай",
  Japanese: "Япония",
  British: "Великобритания",
  Swiss: "Швейцария",
  Canadian: "Канада",
  Australian: "Австралия",
};

// Организации и источники данных: их принято оставлять аббревиатурой, но
// расшифровка идёт в подсказке.
const ORGS: Record<string, string> = {
  FOMC: "FOMC",
  RBA: "РБА",
  BOJ: "Банк Японии",
  BOE: "Банк Англии",
  ECB: "ЕЦБ",
  SNB: "Нацбанк Швейцарии",
  RBNZ: "Резервный банк Новой Зеландии",
  BOC: "Банк Канады",
  Fed: "ФРС",
  "Cleveland Fed": "ФРБ Кливленда",
  UoM: "Мичиганский университет",
  CB: "Conference Board",
  NAB: "NAB",
  NFIB: "NFIB",
  RICS: "RICS",
  BRC: "BRC",
  API: "API",
  ADP: "ADP",
  Sentix: "Sentix",
  BusinessNZ: "BusinessNZ",
  ISM: "ISM",
  NBS: "Госстат КНР",
  ANZ: "ANZ",
  MI: "Melbourne Institute",
  GfK: "GfK",
  Westpac: "Westpac",
  Halifax: "Halifax",
  Nationwide: "Nationwide",
  Tankan: "Tankan",
  AIG: "AIG",
  CBI: "CBI",
  Ifo: "Ifo",
  ZEW: "ZEW",
  KOF: "KOF",
  Buba: "Бундесбанк",
  "IBD/TIPP": "IBD/TIPP",
  Caixin: "Caixin",
  JOLTS: "JOLTS",
  Challenger: "Challenger",
};

// Названия органов в родительном падеже: «выступление главы Банка Англии», а
// не «главы Банк Англии». Отдельная карта, потому что в остальных местах орган
// стоит в скобках и склонять его не нужно.
const ORGS_GENITIVE: Record<string, string> = {
  BOE: "Банка Англии",
  BOJ: "Банка Японии",
  BOC: "Банка Канады",
  SNB: "Нацбанка Швейцарии",
  RBNZ: "Резервного банка Новой Зеландии",
};

// Должности спикеров: «FOMC Member Barkin Speaks» → «выступление члена FOMC».
const ROLES: Record<string, string> = {
  "Assist Gov": "заместителя главы",
  "Deputy Gov": "заместителя главы",
  "Treasury Sec": "министра финансов",
  Member: "члена",
  Gov: "главы",
  Governor: "главы",
  Chair: "главы",
  President: "главы",
  "Vice Chair": "заместителя главы",
  Treasurer: "министра финансов",
};

// ─── Перевод ──────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Термины сортируем по длине: «Core Retail Sales» должен сработать раньше,
// чем «Retail Sales», иначе от длинного названия останется хвост.
const SORTED_TERMS = [...TERMS].sort((a, b) => b.en.length - a.en.length);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Термин, по которому показываем пояснение (первый распознанный с explain).
function matchTerm(title: string): Term | null {
  for (const term of SORTED_TERMS) {
    if (!term.explain) continue;
    if (new RegExp(`\\b${escapeRe(term.en)}\\b`, "i").test(title)) return term;
  }
  return null;
}

export function explainEvent(title: string, locale: Locale): string | null {
  return matchTerm(title)?.explain?.[locale] ?? null;
}

export function translateEventTitle(title: string, locale: Locale): string {
  if (locale !== "ru") return title;
  let rest = title.trim();
  if (!rest) return title;

  // 1. Период в конце: «Core CPI m/m» → период отделяем и вернём хвостом.
  let period = "";
  for (const [en, ru] of Object.entries(PERIODS)) {
    const re = new RegExp(`\\s${escapeRe(en)}$`, "i");
    if (re.test(rest)) {
      period = ru;
      rest = rest.replace(re, "");
      break;
    }
  }

  // 2. Аукционы облигаций: «German 30-y Bond Auction».
  const auction = rest.match(/^(?:(\w+)\s)?(\d+)-y Bond Auction$/i);
  if (auction) {
    const country = auction[1] ? COUNTRIES[auction[1]] : null;
    const head = `Аукцион ${auction[2]}-летних гособлигаций`;
    return country ? `${head} (${country})` : head;
  }

  // 3. Выступления: «FOMC Member Barkin Speaks», «RBA Gov Bullock Speaks».
  const speaks = rest.match(/^(.+?)\s+(Speaks|Testifies)$/i);
  if (speaks) {
    let who = speaks[1];
    let org = "";
    let role = "";
    for (const [en, ru] of Object.entries(ORGS)) {
      const re = new RegExp(`^${escapeRe(en)}\\s`, "");
      if (re.test(who)) {
        org = ORGS_GENITIVE[en] ?? ru;
        who = who.replace(re, "");
        break;
      }
    }
    for (const en of Object.keys(ROLES).sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`^${escapeRe(en)}\\s`, "i");
      if (re.test(who)) {
        role = ROLES[en];
        who = who.replace(re, "");
        break;
      }
    }
    // Фамилию оставляем латиницей: транслитерация даёт больше вреда, чем
    // пользы («Bullock» → «Буллок»/«Баллок», и человека уже не найти).
    // Testifies — это выступление перед парламентом (в США — перед Конгрессом);
    // помечаем отдельно: такие слушания идут часами и двигают рынок иначе.
    const head =
      ["Выступление", role, org].filter(Boolean).join(" ") +
      (/testifies/i.test(speaks[2]) ? " в парламенте" : "");
    return who.trim() ? `${head} (${who.trim()})` : head;
  }

  // 4. Страна в начале: «German Final CPI m/m».
  let country = "";
  const firstWord = rest.split(/\s/)[0];
  if (COUNTRIES[firstWord]) {
    country = COUNTRIES[firstWord];
    rest = rest.slice(firstWord.length).trim();
  }

  // 5. Модификатор: Flash / Prelim / Final.
  let modifier = "";
  const modWord = rest.split(/\s/)[0];
  if (MODIFIERS[modWord]) {
    modifier = MODIFIERS[modWord];
    rest = rest.slice(modWord.length).trim();
  }

  // 6. Организация-источник: «UoM Consumer Sentiment», «RBA Rate Statement».
  let org = "";
  for (const [en, ru] of Object.entries(ORGS).sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp(`^${escapeRe(en)}\\s`, "");
    if (re.test(rest)) {
      org = ru;
      rest = rest.replace(re, "");
      break;
    }
  }

  // 7. Сам показатель.
  let core = rest;
  for (const term of SORTED_TERMS) {
    const re = new RegExp(`^${escapeRe(term.en)}$`, "i");
    if (re.test(core)) {
      core = term.ru;
      break;
    }
  }
  // Показатель не в словаре — оставляем как есть, но остальное уже переведено.

  const head = core;
  const tail = [modifier, org, country, period].filter(Boolean).join(", ");
  return capitalize(tail ? `${head} (${tail})` : head);
}
