import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import RiskHistory from "@/components/RiskHistory";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "en", timezone: "UTC" }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as never;

const change = {
  id: "v3",
  accountId: "acc-1",
  accountLabel: "Bybit main",
  effectiveFrom: "2026-10-13T16:42:00.000Z",
  amount: 100,
  riskPerTrade: { on: true, value: 1, unit: "pct" as const },
  prevAmount: 50,
  prevRiskPerTrade: { on: true, value: 0.5, unit: "pct" as const },
  comment: "40 сделок по системе, повышаю риск по плану роста",
  kind: "change" as const,
};
const auto = {
  ...change,
  id: "v2",
  amount: 50,
  prevAmount: 47.2,
  riskPerTrade: { on: true, value: 0.5, unit: "pct" as const },
  prevRiskPerTrade: { on: true, value: 0.5, unit: "pct" as const },
  comment: null,
  kind: "auto" as const,
};
const setup_ = {
  ...change,
  id: "v0",
  amount: 25,
  prevAmount: null,
  riskPerTrade: { on: true, value: 0.5, unit: "pct" as const },
  prevRiskPerTrade: { on: false, value: 0, unit: "pct" as const },
  comment: null,
  kind: "setup" as const,
};
const initial = {
  ...change,
  id: "v1",
  effectiveFrom: new Date(0).toISOString(),
  prevAmount: null,
  prevRiskPerTrade: null,
  comment: null,
  kind: "initial" as const,
};

function setup(entries: unknown[]) {
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ entries }) });
}

describe("RiskHistory", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("ничего не рисует, пока история не загружена", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<RiskHistory />);
    expect(container).toBeEmptyDOMElement();
  });

  it("показывает решение вместе с комментарием", async () => {
    setup([change]);
    render(<RiskHistory />);
    await waitFor(() => expect(screen.getByText("risk.history.title")).toBeInTheDocument());
    expect(screen.getByText(/40 сделок по системе/)).toBeInTheDocument();
    // Направление видно до чтения цифр.
    expect(screen.getByText("risk.history.up")).toBeInTheDocument();
  });

  it("снижение риска помечается отдельно", async () => {
    setup([{ ...change, amount: 50, prevAmount: 100 }]);
    render(<RiskHistory />);
    await waitFor(() => expect(screen.getByText("risk.history.down")).toBeInTheDocument());
  });

  it("пересчёт по капиталу не просит объяснений", async () => {
    setup([auto]);
    render(<RiskHistory />);
    await waitFor(() => expect(screen.getByText("risk.history.auto")).toBeInTheDocument());
    expect(screen.queryByText("risk.history.noComment")).not.toBeInTheDocument();
    expect(screen.queryByText("risk.history.up")).not.toBeInTheDocument();
  });

  it("начальное значение показывается одной строкой", async () => {
    setup([initial]);
    render(<RiskHistory />);
    await waitFor(() => expect(screen.getByText("risk.history.initial")).toBeInTheDocument());
  });

  it("первая настройка риска не выдаётся за решение без комментария", async () => {
    setup([setup_]);
    render(<RiskHistory />);
    await waitFor(() => expect(screen.getByText("risk.history.setup")).toBeInTheDocument());
    // Иначе журнал врал бы о причине, по которой комментария нет.
    expect(screen.queryByText("risk.history.noComment")).not.toBeInTheDocument();
  });

  it("у старых решений без комментария — своя подпись", async () => {
    setup([{ ...change, comment: null }]);
    render(<RiskHistory />);
    await waitFor(() => expect(screen.getByText("risk.history.noComment")).toBeInTheDocument());
  });

  it("пустая история объясняет, откуда она возьмётся", async () => {
    setup([]);
    render(<RiskHistory />);
    await waitFor(() => expect(screen.getByText("risk.history.empty")).toBeInTheDocument());
  });

  it("фильтр по счетам появляется только когда счетов больше одного", async () => {
    setup([change]);
    const one = render(<RiskHistory />);
    await waitFor(() => expect(screen.getByText("risk.history.title")).toBeInTheDocument());
    expect(screen.queryByText("risk.history.allAccounts")).not.toBeInTheDocument();
    one.unmount();

    setup([change, { ...auto, accountId: "acc-2", accountLabel: "Binance" }]);
    render(<RiskHistory />);
    await waitFor(() => expect(screen.getByText("risk.history.allAccounts")).toBeInTheDocument());
  });

  it("перечитывает историю после сохранения настроек", async () => {
    setup([change]);
    const { rerender } = render(<RiskHistory reloadKey={0} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    rerender(<RiskHistory reloadKey={1} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });
});
