import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

describe("AdminForexPage", () => {
  it("renders heading and both forex admin components", async () => {
    const ui = await AdminForexPage();
    render(ui as React.ReactElement);
    expect(screen.getByText("admin.forex.title")).toBeInTheDocument();
    expect(screen.getByTestId("admin-forex")).toBeInTheDocument();
    expect(screen.getByTestId("admin-forex-config")).toBeInTheDocument();
  });
});
