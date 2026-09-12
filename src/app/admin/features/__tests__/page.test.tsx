import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminFeaturesPage from "../page";

vi.mock("@/components/admin/AdminFeaturesTabs", () => ({
  default: () => <div data-testid="admin-features-tabs">AdminFeaturesTabs</div>,
}));

describe("AdminFeaturesPage", () => {
  it("renders heading and AdminFeaturesTabs component", () => {
    render(<AdminFeaturesPage />);
    expect(screen.getByText("Прочие функции")).toBeInTheDocument();
    expect(screen.getByTestId("admin-features-tabs")).toBeInTheDocument();
  });
});
