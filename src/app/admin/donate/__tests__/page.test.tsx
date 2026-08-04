import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminDonatePage from "../page";

vi.mock("@/components/AdminDonate", () => ({
  default: () => <div data-testid="admin-donate">AdminDonate</div>,
}));

describe("AdminDonatePage", () => {
  it("renders heading and AdminDonate component", () => {
    render(<AdminDonatePage />);
    expect(screen.getByText("Кошельки для донатов")).toBeInTheDocument();
    expect(screen.getByTestId("admin-donate")).toBeInTheDocument();
  });
});
