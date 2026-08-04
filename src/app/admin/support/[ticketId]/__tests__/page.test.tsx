import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminSupportThreadPage from "../page";

vi.mock("@/components/AdminSupportThread", () => ({
  default: ({ ticketId }: { ticketId: string }) => (
    <div data-testid="admin-support-thread">{ticketId}</div>
  ),
}));

describe("AdminSupportThreadPage", () => {
  it("passes ticketId param through to AdminSupportThread", async () => {
    const ui = await AdminSupportThreadPage({
      params: Promise.resolve({ ticketId: "ticket-42" }),
    });
    render(ui as React.ReactElement);
    expect(screen.getByTestId("admin-support-thread")).toHaveTextContent("ticket-42");
  });
});
