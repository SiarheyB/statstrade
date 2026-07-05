// Russian descriptions for финансовых/английских терминов used across the UI.
// Shown as a hover tooltip via the <Term> component where a word can't be
// cleanly translated (industry-standard names).

export const GLOSSARY: Record<string, string> = {
  "P&L": "Profit & Loss — прибыль или убыток по сделкам (в валюте котировки).",
  "Win Rate": "Доля прибыльных сделок от их общего числа.",
  "Profit Factor":
    "Отношение валовой прибыли к валовому убытку. Больше 1 — стратегия прибыльна.",
  Payoff: "Payoff Ratio — отношение средней прибыли к среднему убытку.",
  "Payoff Ratio": "Отношение средней прибыли к среднему убытку.",
  RR: "Risk/Reward (R-кратность) — чистый P&L, делённый на риск (вход→стоп × объём).",
  Drawdown: "Просадка — падение капитала от пика до дна.",
  Equity: "Кривая капитала — как меняется счёт во времени.",
  Return: "Доходность сделки — чистый P&L в % от стоимости позиции.",
  Fees: "Комиссии биржи по сделке; уже вычтены из чистого P&L.",
  Expectancy:
    "Математическое ожидание — средняя прибыль или убыток на одну сделку.",
  ROI: "Return on Investment — доходность на вложенный капитал, в процентах.",
  Sharpe:
    "Коэффициент Шарпа — доходность с поправкой на общий риск (волатильность). >1 — хорошо, >2 — отлично.",
  Sortino:
    "Коэффициент Сортино — как Шарп, но учитывает только убыточную волатильность.",
  Calmar:
    "Коэффициент Кальмара — годовая доходность, делённая на максимальную просадку.",
  "Recovery Factor":
    "Отношение чистой прибыли к максимальной просадке — способность восстанавливаться после убытков.",
  "Kelly %":
    "Критерий Келли — рекомендуемая доля капитала на сделку для максимального роста счёта.",
  "Ulcer Index":
    "Индекс язвы — мера глубины и длительности просадок (психологический стресс удержания).",
  "Downside deviation":
    "Нисходящее отклонение — волатильность только убыточных периодов (годовая, %).",
  Long: "Длинная позиция — покупка в расчёте на рост цены.",
  Short: "Короткая позиция — продажа в расчёте на падение цены.",
  spot: "Спотовый рынок — торговля реальным активом без плеча.",
  perp: "Бессрочный фьючерс (perpetual) — контракт с плечом, без даты экспирации.",
  "API Key": "Публичный идентификатор ключа доступа, выданного биржей.",
  "API Secret":
    "Секретная часть ключа. Храните в тайне; используется только для чтения.",
  Passphrase: "Дополнительная парольная фраза к ключу (требуется для OKX).",
  MFE: "Maximum Favorable Excursion — насколько цена уходила в вашу пользу за время удержания сделки, в % от входа.",
  MAE: "Maximum Adverse Excursion — насколько цена уходила против вас за время удержания сделки, в % от входа.",
  "Best Exit": "Лучшая возможная цена выхода за время удержания сделки — «идеальный» выход, если бы вы поймали максимум движения.",
};

export function hasTerm(key: string): boolean {
  return key in GLOSSARY;
}

// Ordered longest-first so multi-word terms win over their substrings.
const SUBTERMS = [
  "Downside deviation",
  "Recovery Factor",
  "Profit Factor",
  "Payoff Ratio",
  "Ulcer Index",
  "Win Rate",
  "Expectancy",
  "Kelly %",
  "Sharpe",
  "Sortino",
  "Calmar",
  "Payoff",
  "ROI",
  "RR",
  "P&L",
];

// Find the glossary term contained in a (possibly Russian) label, if any.
export function matchTerm(label: string): string | undefined {
  if (GLOSSARY[label]) return label;
  for (const k of SUBTERMS) {
    if (label.includes(k)) return k;
  }
  return undefined;
}
