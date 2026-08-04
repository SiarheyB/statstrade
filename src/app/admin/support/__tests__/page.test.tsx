import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminSupportPage from "../page";

vi.mock("@/components/AdminSupport", () => ({
  default: () => <div data-testid="admin-support">AdminSupport</div>,
}));
vi.mock("@/lib/i18n/server", () => ({
  getServerT: async () => ({
    t: (k: string) => k,
    locale: "ru",
  }),
}));

describe("AdminSupportPage", () => {
  it("renders heading and AdminSupport component", async () => {
    const ui = await AdminSupportPage();
    render(ui as React.ReactElement);
    expect(screen.getByText("admin.support.title")).toBeInTheDocument();
    expect(screen.getByTestId("admin-support")).toBeInTheDocument();
  });
});
