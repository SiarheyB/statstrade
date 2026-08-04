import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RiskSettingsPage from "../page";

vi.mock("@/components/RiskManager", () => ({
  default: () => <div data-testid="risk-manager">RiskManager</div>,
}));

describe("RiskSettingsPage", () => {
  it("renders the RiskManager component", () => {
    render(<RiskSettingsPage />);
    expect(screen.getByTestId("risk-manager")).toBeInTheDocument();
  });
});
