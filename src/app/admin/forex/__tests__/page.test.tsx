import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AdminForexPage from "../page";

vi.mock("@/components/AdminForex", () => ({
  default: () => <div data-testid="admin-forex">AdminForex</div>,
}));
vi.mock("@/components/AdminForexConfig", () => ({
  default: () => <div data-testid="admin-forex-config">AdminForexConfig</div>,
}));
vi.mock("@/lib/i18n/server", () => ({
  getServerT: async () => ({
    t: (k: string) => k,
    locale: "ru",
  }),
}));

// Страница разбита на вкладки (AdminForexTabs) — статус и настройки больше
// не видны одновременно, переключаются кнопками в шапке.
describe("AdminForexPage", () => {
  it("shows the overview tab by default, settings after a click", async () => {
    const ui = await AdminForexPage();
    render(ui as React.ReactElement);

    expect(screen.getByText("admin.forex.title")).toBeInTheDocument();
    expect(screen.getByTestId("admin-forex")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-forex-config")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Настройки"));

    expect(screen.getByTestId("admin-forex-config")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-forex")).not.toBeInTheDocument();
  });
});
