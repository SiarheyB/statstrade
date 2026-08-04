import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminExchangesPage from "../page";

vi.mock("@/components/AdminExchanges", () => ({
  default: () => <div data-testid="admin-exchanges">AdminExchanges</div>,
}));

describe("AdminExchangesPage", () => {
  it("renders heading and AdminExchanges component", () => {
    render(<AdminExchangesPage />);
    expect(screen.getByText("Биржи")).toBeInTheDocument();
    expect(screen.getByTestId("admin-exchanges")).toBeInTheDocument();
  });
});
