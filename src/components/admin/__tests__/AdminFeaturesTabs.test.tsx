import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AdminFeaturesTabs from "@/components/admin/AdminFeaturesTabs";

vi.mock("@/components/admin/FeatureConfigGroup", () => ({
  default: ({ keys }: { keys: string[] }) => <div data-testid="feature-config-group">{keys.join(",")}</div>,
}));

// Каждый индикатор — своя кнопка (не одна общая на все сразу); «Разделы
// кабинета» — единственная вкладка на два ключа, playbooks и mentorMode не
// индикаторы, а целые страницы.
describe("AdminFeaturesTabs", () => {
  it("shows one indicator per tab, switches on click", () => {
    render(<AdminFeaturesTabs />);

    expect(screen.getByTestId("feature-config-group")).toHaveTextContent("volumeProfile");

    fireEvent.click(screen.getByText("Divergence Scanner"));
    expect(screen.getByTestId("feature-config-group")).toHaveTextContent("divergenceScanner");

    fireEvent.click(screen.getByText("Bid/Ask Imbalance"));
    expect(screen.getByTestId("feature-config-group")).toHaveTextContent("imbalanceIndicator");

    fireEvent.click(screen.getByText("Exit Efficiency"));
    expect(screen.getByTestId("feature-config-group")).toHaveTextContent("exitEfficiency");

    fireEvent.click(screen.getByText("Monte Carlo"));
    expect(screen.getByTestId("feature-config-group")).toHaveTextContent("monteCarlo");

    fireEvent.click(screen.getByText("Разделы кабинета"));
    expect(screen.getByTestId("feature-config-group")).toHaveTextContent("playbooks,mentorMode");
  });
});
