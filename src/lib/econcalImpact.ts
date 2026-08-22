// Важность событий экономического календаря по шкале ru.investing.com.
//
// Зачем: события мы берём из бесплатного фида ForexFactory/faireconomy, а он
// метит важность по своей шкале — она заметно расходится с investing.com,
// на который ориентируются пользователи. Примеры: недельные Unemployment
// Claims и предварительные PMI США у фида «low», у investing — три звезды;
// канадский CPI у фида «high», у investing — две звезды.
//
// Здесь соответствие «название события в фиде» → важность по investing:
// 3 звезды → high (красная точка), 2 → medium (жёлтая), 1 → low (серая).
//
// ВАЖНО: снимать звёзды нужно с РУССКОЙ версии (ru.investing.com) — у неё своя
// оценка, и она расходится с англоязычной. Например, новозеландский торговый
// баланс: на investing.com одна звезда, на ru.investing.com — две.
//
// MEASURED снято с ru.investing.com 2026-08-22 за неделю 17–21 августа 2026:
// строки календаря сопоставлены с фидом по валюте, времени выхода и названию
// (у investing и ForexFactory они пишутся по-разному).
// DERIVED — события, которых в этом окне не было. Часть снята там же за неделю
// 24–28 августа, остальные (NFP, ISM, JOLTS, решения по ставке, CPI США)
// выведены по тому, как investing оценивает тот же класс релизов: первый эшелон
// статистики США и решения центробанков — три звезды, второй эшелон — две.
// Событие, которого нет ни там, ни там, остаётся с импактом фида.
//
// Обновлять: открыть ru.investing.com/economic-calendar, сверить звёзды и
// поправить значения ниже; кода менять не нужно, правка видна сразу.

export type Impact = "high" | "medium" | "low" | "holiday";
type Rated = Exclude<Impact, "holiday">;

// Названия — ровно как в фиде (поле title), регистр и пробелы не важны.
const MEASURED: Record<string, Record<string, Rated>> = {
  USD: {
    "ADP Weekly Employment Change": "medium",
    "API Weekly Statistical Bulletin": "medium",
    "Building Permits": "medium",
    "Capacity Utilization Rate": "low",
    "CB Leading Index m/m": "medium",
    "Crude Oil Inventories": "high",
    "Empire State Manufacturing Index": "medium",
    "Flash Manufacturing PMI": "high",
    "Flash Services PMI": "high",
    "FOMC Meeting Minutes": "high",
    "Housing Starts": "medium",
    "Import Prices m/m": "medium",
    "Industrial Production m/m": "medium",
    "NAHB Housing Market Index": "low",
    "Natural Gas Storage": "low",
    "Pending Home Sales m/m": "medium",
    "Philly Fed Manufacturing Index": "high",
    "President Trump Speaks": "high",
    "TIC Long-Term Purchases": "medium",
    "Unemployment Claims": "high",
  },
  EUR: {
    "Consumer Confidence": "low",
    "Current Account": "low",
    "ECB President Lagarde Speaks": "medium",
    "Final Core CPI y/y": "medium",
    "Final CPI y/y": "high",
    "Flash Manufacturing PMI": "medium",
    "Flash Services PMI": "medium",
    "French Flash Manufacturing PMI": "medium",
    "French Flash Services PMI": "medium",
    "German 10-y Bond Auction": "medium",
    "German Buba Monthly Report": "low",
    "German Flash Manufacturing PMI": "medium",
    "German Flash Services PMI": "medium",
    "German PPI m/m": "medium",
    "German ZEW Economic Sentiment": "medium",
    "ZEW Economic Sentiment": "medium",
  },
  GBP: {
    "10-y Bond Auction": "low",
    "Average Earnings Index 3m/y": "medium",
    "CBI Industrial Order Expectations": "low",
    "Claimant Count Change": "medium",
    "Core CPI y/y": "low",
    "CPI y/y": "high",
    "Flash Manufacturing PMI": "low",
    "Flash Services PMI": "medium",
    "GfK Consumer Confidence": "low",
    "HPI y/y": "low",
    "PPI Input m/m": "medium",
    "PPI Output m/m": "low",
    "Public Sector Net Borrowing": "low",
    "Retail Sales m/m": "medium",
    "Rightmove HPI m/m": "low",
    "RPI y/y": "low",
    "Unemployment Rate": "medium",
  },
  JPY: {
    "Core Machinery Orders m/m": "low",
    "Flash Manufacturing PMI": "low",
    "National Core CPI y/y": "medium",
    "Prelim GDP Price Index y/y": "medium",
    "Prelim GDP q/q": "high",
    "Revised Industrial Production m/m": "medium",
    "Tertiary Industry Activity m/m": "low",
    "Trade Balance": "medium",
  },
  CAD: {
    "Common CPI y/y": "low",
    "Core CPI m/m": "medium",
    "Core Retail Sales m/m": "medium",
    "CPI m/m": "medium",
    "Foreign Securities Purchases": "medium",
    "Housing Starts": "medium",
    "IPPI m/m": "low",
    "Median CPI y/y": "low",
    "NHPI m/m": "medium",
    "Retail Sales m/m": "medium",
    "RMPI m/m": "medium",
    "Trimmed CPI y/y": "low",
  },
  AUD: {
    "Employment Change": "medium",
    "Flash Manufacturing PMI": "low",
    "Flash Services PMI": "low",
    "MI Inflation Expectations": "low",
    "Unemployment Rate": "medium",
    "Wage Price Index q/q": "medium",
    "Westpac Consumer Sentiment": "low",
  },
  NZD: {
    "BusinessNZ Services Index": "low",
    "Credit Card Spending y/y": "low",
    "FPI m/m": "low",
    "GDT Price Index": "low",
    "PPI Input q/q": "medium",
    "PPI Output q/q": "low",
    "Trade Balance": "medium",
  },
  CNY: {
    "1-y Loan Prime Rate": "medium",
    "5-y Loan Prime Rate": "medium",
    "Fixed Asset Investment ytd/y": "medium",
    "Foreign Direct Investment ytd/y": "low",
    "Industrial Production y/y": "medium",
    "NBS Press Conference": "medium",
    "New Home Prices m/m": "low",
    "Retail Sales y/y": "low",
    "Unemployment Rate": "medium",
  },
};

// Важность снята за неделю 24–28 августа либо выведена по классу релиза.
const DERIVED: Record<string, Record<string, Rated>> = {
  USD: {
    "ADP Non-Farm Employment Change": "high",
    "Advance GDP q/q": "high",
    "Average Hourly Earnings m/m": "high",
    "CB Consumer Confidence": "high",
    "Chicago PMI": "high",
    "Construction Spending m/m": "medium",
    "Core CPI m/m": "high",
    "Core CPI y/y": "high",
    "Core Durable Goods Orders m/m": "medium",
    "Core PCE Price Index m/m": "high",
    "Core Retail Sales m/m": "high",
    "CPI m/m": "high",
    "CPI y/y": "high",
    "Durable Goods Orders m/m": "medium",
    "Factory Orders m/m": "medium",
    "Fed Chair Powell Speaks": "high",
    "Final GDP q/q": "high",
    "FOMC Economic Projections": "high",
    "FOMC Press Conference": "high",
    "FOMC Statement": "high",
    "Goods Trade Balance": "medium",
    "ISM Manufacturing PMI": "high",
    "ISM Manufacturing Prices": "high",
    "ISM Services PMI": "high",
    "ISM Services Prices": "high",
    "Jackson Hole Symposium": "medium",
    "JOLTS Job Openings": "high",
    "New Home Sales": "high",
    "Non-Farm Employment Change": "high",
    "PCE Price index m/m": "medium",
    "Personal Spending m/m": "medium",
    "Prelim GDP Price Index q/q": "medium",
    "Prelim GDP q/q": "high",
    "Prelim Nonfarm Productivity q/q": "medium",
    "Prelim Unit Labor Costs q/q": "medium",
    "Prelim UoM Consumer Sentiment": "medium",
    "Retail Inventories Ex Auto": "medium",
    "Retail Sales m/m": "high",
    "Revised UoM Consumer Sentiment": "medium",
    "S&P/CS Composite-20 HPI y/y": "medium",
    "Trade Balance": "medium",
    "Unemployment Rate": "high",
  },
  EUR: {
    "Core CPI Flash Estimate y/y": "medium",
    "CPI Flash Estimate y/y": "high",
    "Final Manufacturing PMI": "medium",
    "Final Services PMI": "medium",
    "French Consumer Spending m/m": "medium",
    "French Prelim CPI m/m": "medium",
    "French Prelim GDP q/q": "medium",
    "German Factory Orders m/m": "medium",
    "German Final CPI m/m": "medium",
    "German Final GDP q/q": "medium",
    "German GfK Consumer Climate": "medium",
    "German ifo Business Climate": "medium",
    "German Prelim CPI m/m": "high",
    "German Prelim GDP q/q": "high",
    "German Retail Sales m/m": "medium",
    "German Unemployment Change": "medium",
    "Monetary Policy Meeting Accounts": "medium",
    "Unemployment Rate": "medium",
  },
  GBP: {
    "Construction PMI": "medium",
    "Final Manufacturing PMI": "low",
    "Final Services PMI": "medium",
    "GDP m/m": "medium",
    "Nationwide HPI m/m": "medium",
  },
  JPY: {
    "BOJ Core CPI y/y": "medium",
    "Capital Spending q/y": "medium",
    "Final Manufacturing PMI": "low",
    "Flash Services PMI": "medium",
    "Household Spending y/y": "medium",
    "Tokyo Core CPI y/y": "medium",
  },
  CAD: {
    "Current Account": "medium",
    "GDP m/m": "medium",
    "Wholesale Sales m/m": "medium",
  },
  AUD: {
    "Building Approvals m/m": "medium",
    "GDP q/q": "medium",
    "RBA Meeting Minutes": "medium",
    "Retail Sales m/m": "medium",
  },
  NZD: {
    "Core Retail Sales q/q": "medium",
    "Retail Sales q/q": "medium",
  },
  CNY: {
    "Caixin Manufacturing PMI": "medium",
    "Caixin Services PMI": "medium",
    "Manufacturing PMI": "high",
    "Non-Manufacturing PMI": "medium",
  },
  CHF: {
    "CPI m/m": "medium",
    "GDP q/q": "medium",
    "KOF Economic Barometer": "medium",
    "Manufacturing PMI": "medium",
  },
};

// Семейства, где название плавает от релиза к релизу.
const PATTERNS: { re: RegExp; currency?: string; impact: Rated }[] = [
  // Решения по ставке и всё вокруг них — у investing всегда три звезды.
  {
    re: /\b(federal funds rate|official bank rate|official cash rate|cash rate|overnight rate|main refinancing rate|snb policy rate|boj policy rate|monetary policy statement|rate statement|interest rate decision)\b/i,
    impact: "high",
  },
  // Пресс-конференции и голосования по ставке идут тем же блоком.
  { re: /\b(press conference|bank rate votes|economic projections)\b/i, impact: "high" },
  // Речи глав центробанков investing держит на второй ступени (первую в этом
  // классе занимают только выступления по итогам заседания — они выше).
  { re: /\bspeaks\b/i, impact: "medium" },
  // Аукционы векселей — нижняя ступень у всех стран.
  { re: /\bbill auction\b/i, impact: "low" },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const TABLE = new Map<string, Rated>();
for (const source of [MEASURED, DERIVED]) {
  for (const [currency, titles] of Object.entries(source)) {
    for (const [title, impact] of Object.entries(titles)) {
      TABLE.set(`${currency}|${norm(title)}`, impact);
    }
  }
}

// Важность по investing или null, если событие нам неизвестно.
export function investingImpact(title: string, currency: string): Rated | null {
  const exact = TABLE.get(`${currency}|${norm(title)}`);
  if (exact) return exact;
  for (const p of PATTERNS) {
    if (p.currency && p.currency !== currency) continue;
    if (p.re.test(title)) return p.impact;
  }
  return null;
}

// Итоговая важность события: шкала investing, а для незнакомых событий —
// то, что сказал фид.
export function resolveImpact(title: string, currency: string, feedImpact: string): string {
  if (feedImpact === "holiday") return feedImpact;
  return investingImpact(title, currency) ?? feedImpact;
}
