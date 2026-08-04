import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminFeaturesPage from "../page";

vi.mock("@/components/AdminFeatures", () => ({
  default: () => <div data-testid="admin-features">AdminFeatures</div>,
}));

describe("AdminFeaturesPage", () => {
  it("renders heading and AdminFeatures component", () => {
    render(<AdminFeaturesPage />);
    expect(screen.getByText("Функции")).toBeInTheDocument();
    expect(screen.getByTestId("admin-features")).toBeInTheDocument();
  });
});
