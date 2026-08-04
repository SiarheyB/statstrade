import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminAnnouncementsPage from "../page";

vi.mock("@/components/AdminAnnouncements", () => ({
  default: () => <div data-testid="admin-announcements">AdminAnnouncements</div>,
}));

describe("AdminAnnouncementsPage", () => {
  it("renders heading and AdminAnnouncements component", () => {
    render(<AdminAnnouncementsPage />);
    expect(screen.getByText("Объявления")).toBeInTheDocument();
    expect(screen.getByTestId("admin-announcements")).toBeInTheDocument();
  });
});
