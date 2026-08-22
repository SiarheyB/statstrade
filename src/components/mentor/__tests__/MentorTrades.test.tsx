import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MentorTrades from "@/components/mentor/MentorTrades";
import type { PublicAccountTrades, PublicTrade } from "@/lib/mentorShare";

// Просмотрщик подменяем заглушкой: нас интересует, ЧТО ему передали и как
// работает листание, а не зум с панорамированием (они проверены отдельно).
vi.mock("@/components/ImagePreviewModal", () => ({
  default: ({
    url,
    position,
    onPrev,
    onNext,
    onClose,
  }: {
    url: string;
    position?: { index: number; total: number };
    onPrev?: () => void;
    onNext?: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="preview">
      <span data-testid="preview-url">{url}</span>
      <span data-testid="preview-pos">{position ? `${position.index}/${position.total}` : ""}</span>
      <button onClick={onPrev}>prev</button>
      <button onClick={onNext}>next</button>
      <button onClick={onClose}>close</button>
    </div>
  ),
}));
vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}:${JSON.stringify(vars)}` : k),
    locale: "ru",
    timezone: "auto",
  }),
}));

function trade(over: Partial<PublicTrade> & { id: string }): PublicTrade {
  return {
    symbol: "BTC/USDT",
    side: "long",
    market: "swap",
    entryTime: "2026-06-01T10:00:00.000Z",
    exitTime: "2026-06-01T12:00:00.000Z",
    durationMs: 7_200_000,
    entryPrice: 60000,
    exitPrice: 61000,
    returnPct: 0.016,
    rr: 2,
    result: "win",
    imageUrl: null,
    stopLoss: null,
    entryPoint: null,
    entryType: null,
    pattern: null,
    mistake: null,
    note: null,
    ...over,
  };
}

const ACCOUNTS: PublicAccountTrades[] = [
  {
    accountId: "a1",
    label: "Основной",
    exchange: "bybit",
    trades: [
      trade({ id: "t1", pattern: "Пробой", entryPoint: "Ретест", mistake: "Ранний вход" }),
      trade({ id: "t2", pattern: "Отбой", entryPoint: "Наторговка", entryType: "Агрессивный" }),
    ],
  },
  {
    accountId: "a2",
    label: "Форекс",
    exchange: "mt5",
    trades: [trade({ id: "t3", symbol: "EUR/USD", pattern: "Пробой" })],
  },
];

describe("MentorTrades", () => {
  it("фильтрует сделки по паттерну сразу во всех счетах", () => {
    render(<MentorTrades accounts={ACCOUNTS} />);
    expect(screen.getAllByText(/BTCUSDT|EURUSD/)).toHaveLength(3);

    // Первый селект — паттерн (порядок как в шапке фильтров).
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Отбой" } });

    expect(screen.getAllByText("BTCUSDT")).toHaveLength(1);
    expect(screen.queryByText("EURUSD")).not.toBeInTheDocument();
    // Счёт, где ничего не осталось, не показываем вовсе.
    expect(screen.queryByText("Форекс")).not.toBeInTheDocument();
  });

  it("складывает фильтры друг с другом и сбрасывается одной кнопкой", () => {
    render(<MentorTrades accounts={ACCOUNTS} />);
    const [pattern, entryPoint] = screen.getAllByRole("combobox");

    fireEvent.change(pattern, { target: { value: "Пробой" } });
    fireEvent.change(entryPoint, { target: { value: "Ретест" } });
    expect(screen.getAllByText(/BTCUSDT|EURUSD/)).toHaveLength(1);

    fireEvent.click(screen.getByText(/mentorPage\.reset/));
    expect(screen.getAllByText(/BTCUSDT|EURUSD/)).toHaveLength(3);
  });

  it("в списке фильтра только те значения, что есть в сделках", () => {
    render(<MentorTrades accounts={ACCOUNTS} />);
    const mistake = screen.getAllByRole("combobox")[3];
    expect([...mistake.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "mentorPage.any",
      "Ранний вход",
    ]);
  });

  it("говорит, когда под фильтры не подошла ни одна сделка", () => {
    render(<MentorTrades accounts={[{ ...ACCOUNTS[0], trades: [ACCOUNTS[0].trades[0]] }]} />);
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "Ретест" } });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Пробой" } });
    expect(screen.getAllByText("BTCUSDT")).toHaveLength(1);

    // Такой пары в данных нет.
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "Ретест" } });
    fireEvent.change(screen.getAllByRole("combobox")[3], { target: { value: "Ранний вход" } });
    expect(screen.getAllByText("BTCUSDT")).toHaveLength(1);
  });

  it("разбор раскрывается по клику и не показывает денег", () => {
    render(<MentorTrades accounts={[ACCOUNTS[0]]} />);
    fireEvent.click(screen.getAllByText("BTCUSDT")[0]);

    // В раскрытой панели — все поля разбора.
    expect(screen.getAllByText("mentorPage.col.entryType").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ранний вход").length).toBeGreaterThan(0);
    // Ни P&L, ни комиссий, ни объёма в разметке нет.
    expect(document.body.textContent).not.toMatch(/\$|P&L/);
  });

  it("листает скриншоты, не закрывая просмотр, и ходит по кругу", () => {
    const withShots: PublicAccountTrades[] = [
      {
        accountId: "a1",
        label: "Основной",
        exchange: "bybit",
        trades: [
          trade({ id: "s1", imageUrl: "https://img/1" }),
          trade({ id: "s2", imageUrl: null }), // без скриншота — в листании не участвует
          trade({ id: "s3", imageUrl: "https://img/3" }),
        ],
      },
      {
        accountId: "a2",
        label: "Форекс",
        exchange: "mt5",
        trades: [trade({ id: "s4", symbol: "EUR/USD", imageUrl: "https://img/4" })],
      },
    ];
    render(<MentorTrades accounts={withShots} />);
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();

    // Открываем первый скриншот.
    fireEvent.click(screen.getAllByRole("button", { name: /mentorPage\.open/ })[0]);
    expect(screen.getByTestId("preview-url")).toHaveTextContent("https://img/1");
    expect(screen.getByTestId("preview-pos")).toHaveTextContent("1/3");

    // Вперёд — сделка без скриншота пропускается.
    fireEvent.click(screen.getByText("next"));
    expect(screen.getByTestId("preview-url")).toHaveTextContent("https://img/3");

    // Листание идёт и через границу счетов.
    fireEvent.click(screen.getByText("next"));
    expect(screen.getByTestId("preview-url")).toHaveTextContent("https://img/4");
    expect(screen.getByTestId("preview-pos")).toHaveTextContent("3/3");

    // С последнего — снова на первый.
    fireEvent.click(screen.getByText("next"));
    expect(screen.getByTestId("preview-url")).toHaveTextContent("https://img/1");
    // И назад с первого — на последний.
    fireEvent.click(screen.getByText("prev"));
    expect(screen.getByTestId("preview-url")).toHaveTextContent("https://img/4");

    fireEvent.click(screen.getByText("close"));
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
  });

  it("листает только то, что осталось после фильтра", () => {
    const withShots: PublicAccountTrades[] = [
      {
        accountId: "a1",
        label: "Основной",
        exchange: "bybit",
        trades: [
          trade({ id: "s1", pattern: "Пробой", imageUrl: "https://img/1" }),
          trade({ id: "s2", pattern: "Отбой", imageUrl: "https://img/2" }),
        ],
      },
    ];
    render(<MentorTrades accounts={withShots} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Отбой" } });

    fireEvent.click(screen.getByRole("button", { name: /mentorPage\.open/ }));
    expect(screen.getByTestId("preview-url")).toHaveTextContent("https://img/2");
    // Скрытая фильтром сделка в просмотре не всплывает.
    expect(screen.getByTestId("preview-pos")).toHaveTextContent("1/1");
  });

  it("в разборе — время и комментарий, без повтора того, что уже в строке", () => {
    render(<MentorTrades accounts={[ACCOUNTS[0]]} />);
    fireEvent.click(screen.getAllByText("BTCUSDT")[0]);

    const panel = document.querySelector("td[colspan]") as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain("mentorPage.col.open");
    expect(panel.textContent).toContain("mentorPage.col.duration");
    expect(panel.textContent).toContain("mentorPage.col.note");
    // Паттерн, ТВХ, тип входа и ошибка остаются только в строке — в разборе
    // их не дублируем.
    expect(panel.textContent).not.toContain("Пробой");
    expect(panel.textContent).not.toContain("Ранний вход");
    expect(panel.textContent).not.toContain("Ретест");
  });
});
