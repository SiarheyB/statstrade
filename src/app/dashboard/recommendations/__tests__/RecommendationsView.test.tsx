import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecommendationsPage from "../RecommendationsView";
import { setFormatLocale, setFormatTimezone } from "@/lib/format";

vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => ({}) }));

const DAY = 86_400_000;
const D = (n: number) => Date.UTC(2026, 7, n);

const QUALITY = {
  crossings: 0,
  falseBreakouts: 0,
  deepestFalseBreakoutAtr: 0,
  contamination: 0.02,
  runwayAtr: 3,
  closeDistanceAtr: 0.1,
  approachGapAtr: 0.1,
};

const SETUPS = [
  {
    id: "1",
    symbol: "BTCUSDT",
    levelPrice: 120,
    levelType: "break_point",
    strength: 3,
    distanceAtr: 0.4,
    bias: "breakout",
    direction: "long",
    signals: { for: ["close_near_level"], against: [] },
    quality: QUALITY,
    atr: 4,
    currentPrice: 118,
    bsuAt: new Date(D(5)).toISOString(),
    candlesTo: new Date(D(12)).toISOString(),
    lastVolume: 12000,
  },
  {
    id: "2",
    symbol: "ETHUSDT",
    levelPrice: 80,
    levelType: "mirror",
    strength: 2,
    distanceAtr: 0.9,
    bias: "false_breakout",
    direction: "long",
    signals: { for: [], against: ["big_bars_approach"] },
    quality: QUALITY,
    atr: 2,
    currentPrice: 84,
    bsuAt: new Date(D(3)).toISOString(),
    candlesTo: new Date(D(12)).toISOString(),
    lastVolume: 25_000_000,
  },
];

// Свечи 01.08–13.08; последняя (13.08) новее candlesTo — это сегодняшний
// незакрытый бар, он в анализе не участвовал. Каждый бар отличается ценой и
// объёмом, чтобы тесты на наведение могли отличить один бар от другого.
const CANDLES = Array.from({ length: 13 }, (_, i) => ({
  t: D(1) + i * DAY,
  o: 100 + i,
  h: 102 + i,
  l: 98 + i,
  c: 100 + i,
  v: 1000 * (i + 1),
}));

function mockFetch() {
  return vi.fn(async (url: string) => {
    if (typeof url === "string" && url.startsWith("/api/features")) {
      return { ok: true, json: async () => ({ value: { enabled: true } }) } as unknown as Response;
    }
    if (typeof url === "string" && url.includes("/candles")) {
      return { ok: true, json: async () => ({ candles: CANDLES }) } as unknown as Response;
    }
    return { ok: true, json: async () => ({ setups: SETUPS }) } as unknown as Response;
  });
}

describe("RecommendationsPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the trade side next to each setup type", async () => {
    render(<RecommendationsPage />);
    expect(await screen.findByText(/Пробой · лонг/)).toBeInTheDocument();
    // Уровень ниже цены → ложный пробой отрабатывается вверх.
    expect(screen.getByText(/Ложный пробой · лонг/)).toBeInTheDocument();
  });

  it("offers no neutral filter", async () => {
    render(<RecommendationsPage />);
    await screen.findByText(/Пробой · лонг/);
    expect(screen.queryByRole("button", { name: "Нейтрально" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Лонг" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Шорт" })).toBeInTheDocument();
  });

  it("filters by trade side", async () => {
    render(<RecommendationsPage />);
    await screen.findByText(/Пробой · лонг/);

    await userEvent.click(screen.getByRole("button", { name: "Шорт" }));
    expect(screen.queryByText("BTCUSDT")).not.toBeInTheDocument();
    expect(screen.queryByText("ETHUSDT")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Лонг" }));
    expect(screen.getByText("BTCUSDT")).toBeInTheDocument();
    expect(screen.getByText("ETHUSDT")).toBeInTheDocument();
  });
});

describe("expanded setup card", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
    setFormatLocale("ru");
    setFormatTimezone("UTC");
  });

  afterEach(() => vi.unstubAllGlobals());

  async function openFirstCard() {
    render(<RecommendationsPage />);
    await screen.findByText(/Пробой · лонг/);
    await userEvent.click(screen.getByText("BTCUSDT"));
  }

  it("labels the bar that formed the level (БСУ) with its date", async () => {
    await openFirstCard();
    expect(await screen.findByText("БСУ — 05.08.2026")).toBeInTheDocument();
  });

  it("says which day the analysis was based on", async () => {
    await openFirstCard();
    expect(await screen.findByText(/анализ по закрытию 12\.08\.2026/)).toBeInTheDocument();
  });

  it("marks the БСУ bar on the chart and dims the still-forming one", async () => {
    await openFirstCard();
    const chart = await screen.findByRole("img", { name: /Дневной график/ });

    // Стрелка с подписью БСУ — напротив бара, сформировавшего уровень.
    expect(chart.textContent).toContain("БСУ");
    // Сегодняшний бар (13.08 — новее candlesTo) приглушён, остальные нет.
    expect(chart.querySelectorAll('g[opacity="0.45"]')).toHaveLength(1);
  });

  it("defaults the OHLC readout to the last closed bar", async () => {
    await openFirstCard();
    const chart = await screen.findByRole("img", { name: /Дневной график/ });
    // candlesTo — 12.08 (i=11): o=111 h=113 l=109 c=111.
    expect(chart.parentElement?.textContent).toContain("O 111.00 H 113.00 L 109.00 C 111.00");
    expect(chart.parentElement?.textContent).toContain("12.08.2026");
  });

  it("shows OHLC and date for the bar under the cursor, and a crosshair", async () => {
    await openFirstCard();
    const chart = await screen.findByRole("img", { name: /Дневной график/ });
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 680,
      height: 320,
      right: 680,
      bottom: 320,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect);

    // Первый бар (01.08, i=0) — самый левый столбец, x у центра первого бара.
    fireEvent.mouseMove(chart, { clientX: 5, clientY: 100 });
    expect(chart.parentElement?.textContent).toContain("O 100.00 H 102.00 L 98.00 C 100.00");
    expect(chart.parentElement?.textContent).toContain("01.08.2026");
    // Перекрестье — пунктирные линии, следующие за курсором.
    expect(chart.querySelectorAll('line[stroke-dasharray="3 3"]').length).toBeGreaterThan(0);

    fireEvent.mouseLeave(chart);
    expect(chart.parentElement?.textContent).not.toContain("O 100.00 H 102.00 L 98.00 C 100.00");
    expect(chart.parentElement?.textContent).toContain("O 111.00 H 113.00 L 109.00 C 111.00");
  });

  it("shows the setup's volume in the collapsed header, no date or ticker", async () => {
    render(<RecommendationsPage />);
    // Видно сразу, без раскрытия карточки — значение приходит с setup.lastVolume.
    const el = await screen.findByText(/объём \$12\s*(тыс\.?|K)/i);
    expect(el).toBeInTheDocument();
    expect(el.textContent).not.toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(el.textContent).not.toMatch(/BTC/);
    // 12 тыс. < 10M — светофор ликвидности красный.
    expect(el).toHaveClass("text-loss");
  });

  // Старые записи писались без части метрик качества — карточка обязана
  // пропустить такой чип, а не падать на undefined.toFixed().
  it("survives a setup whose quality lacks newer metrics", async () => {
    const legacy = [
      {
        ...SETUPS[1],
        id: "legacy",
        symbol: "SQQQ",
        quality: { crossings: 0, falseBreakouts: 0, runwayAtr: 3 },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.startsWith("/api/features")) {
          return { ok: true, json: async () => ({ value: { enabled: true } }) } as unknown as Response;
        }
        if (typeof url === "string" && url.includes("/candles")) {
          return { ok: true, json: async () => ({ candles: CANDLES }) } as unknown as Response;
        }
        return { ok: true, json: async () => ({ setups: legacy }) } as unknown as Response;
      }),
    );

    render(<RecommendationsPage />);
    await screen.findByText(/Ложный пробой · лонг/);
    await userEvent.click(screen.getByText("SQQQ"));

    expect(await screen.findByText("без запилов")).toBeInTheDocument();
    expect(screen.queryByText(/вчера не дошли/)).not.toBeInTheDocument();
    expect(screen.queryByText(/за уровнем чисто/)).not.toBeInTheDocument();
  });

  // Прокол вчерашнего бара не входит в falseBreakouts, и без отдельной ветки
  // чип бодро сообщал бы «ложных пробоев не было» именно в тот день, когда
  // уровень прокололи (реальный случай SHAZUSDT 17.08.2026).
  it("shows yesterday's pierce instead of claiming there were no false breakouts", async () => {
    const pierced = [
      {
        ...SETUPS[1],
        id: "pierced",
        symbol: "SHAZ",
        quality: { crossings: 0, falseBreakouts: 0, lastBarPierceAtr: 0.57, runwayAtr: 3 },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.startsWith("/api/features")) {
          return { ok: true, json: async () => ({ value: { enabled: true } }) } as unknown as Response;
        }
        if (typeof url === "string" && url.includes("/candles")) {
          return { ok: true, json: async () => ({ candles: CANDLES }) } as unknown as Response;
        }
        return { ok: true, json: async () => ({ setups: pierced }) } as unknown as Response;
      }),
    );

    render(<RecommendationsPage />);
    await screen.findByText(/Ложный пробой · лонг/);
    await userEvent.click(screen.getByText("SHAZ"));

    expect(await screen.findByText("прокол вчера 0.57×ATR")).toBeInTheDocument();
    expect(screen.queryByText("ложных пробоев не было")).not.toBeInTheDocument();
  });
});

// Блок «ход инструмента»: ATR показывается всегда, а бюджет хода на сегодня —
// только у ложного пробоя (у пробоя путь до уровня уже пройден вчерашним
// закрытием, и «сколько пройти» там нечего показывать).
describe("ATR panel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
    setFormatLocale("ru");
    setFormatTimezone("UTC");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows the required move for a false breakout, in the list and in the card", async () => {
    render(<RecommendationsPage />);
    // ETHUSDT: цена 84, уровень 80, ATR 2 → до уровня 2×ATR, плюс прокол 0.08.
    expect(await screen.findByText(/нужен ход 2\.08×ATR/)).toBeInTheDocument();

    await userEvent.click(screen.getByText("ETHUSDT"));
    expect(await screen.findByText("ATR — средний дневной ход")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Чтобы ложный пробой состоялся сегодня")).toBeInTheDocument();
    expect(screen.getByText("2.08×ATR")).toBeInTheDocument();
    // Разбор пути: до уровня + прокол, одним баром.
    expect(screen.getByText(/Дойти до уровня — 2\.00×ATR/)).toBeInTheDocument();
    expect(screen.getByText(/проколоть его — ещё 0\.08×ATR/)).toBeInTheDocument();
    // Вердикт по статистике дневных ходов из конспекта.
    expect(screen.getByText("ход, который бывает редко")).toBeInTheDocument();
    expect(screen.getByText(/примерно в 5% дней/)).toBeInTheDocument();
  });

  it("shows how much of the daily ATR today's bar has already spent", async () => {
    render(<RecommendationsPage />);
    await screen.findByText(/Ложный пробой · лонг/);
    await userEvent.click(screen.getByText("ETHUSDT"));
    // Сегодняшний бар в CANDLES: h-l = 4, ATR 2 → 2.00×ATR.
    expect(await screen.findByText(/2\.00×ATR \(200%\)/)).toBeInTheDocument();
    expect(screen.getByText(/дневной ход почти выбран/)).toBeInTheDocument();
  });

  it("keeps the required move consistent with the collapsed header", async () => {
    render(<RecommendationsPage />);
    await screen.findByText(/нужен ход 2\.08×ATR/);
    await userEvent.click(screen.getByText("ETHUSDT"));
    // Обе цифры считаются от цены анализа, поэтому совпадают; живая цена, если
    // ушла, выносится отдельной строкой.
    expect(await screen.findAllByText(/2\.08×ATR/)).toHaveLength(2);
    expect(screen.getByText(/Сейчас цена/)).toBeInTheDocument();
  });

  it("shows the ATR but no move budget for a breakout setup", async () => {
    render(<RecommendationsPage />);
    await screen.findByText(/Пробой · лонг/);
    await userEvent.click(screen.getByText("BTCUSDT"));
    expect(await screen.findByText("ATR — средний дневной ход")).toBeInTheDocument();
    expect(screen.getByText("Путь до уровня")).toBeInTheDocument();
    expect(screen.queryByText("Чтобы ложный пробой состоялся сегодня")).not.toBeInTheDocument();
    expect(screen.getByText(/Для пробоя весь путь уже пройден/)).toBeInTheDocument();
  });
});
