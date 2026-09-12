import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AdminFeaturesTabs from "@/components/admin/AdminFeaturesTabs";

vi.mock("@/components/admin/FeatureConfigGroup", () => ({
  default: ({ keys }: { keys: string[] }) => <div data-testid="feature-config-group">{keys.join(",")}</div>,
}));

// Индикаторы, аналитика и разделы кабинета — разные вкладки, показывают
// только СВОЙ набор ключей одновременно.
describe("AdminFeaturesTabs", () => {
  it("shows indicators by default, switches to other groups on click", () => {
    render(<AdminFeaturesTabs />);

    expect(screen.getByTestId("feature-config-group")).toHaveTextContent(
      "volumeProfile,divergenceScanner,imbalanceIndicator",
    );

    fireEvent.click(screen.getByText("Аналитика"));
    expect(screen.getByTestId("feature-config-group")).toHaveTextContent("exitEfficiency,monteCarlo");

    fireEvent.click(screen.getByText("Разделы кабинета"));
    expect(screen.getByTestId("feature-config-group")).toHaveTextContent("playbooks,mentorMode");
  });
});
