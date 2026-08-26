import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isAdminSession } from "@/lib/admin";
import DashboardLayout from "../layout";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  isAdminSession: vi.fn(() => false),
}));

vi.mock("@/components/DashboardNav", () => ({
  default: ({ email, isAdmin }: { email: string; isAdmin: boolean }) => (
    <div data-testid="dashboard-nav">
      {email}-{String(isAdmin)}
    </div>
  ),
}));

vi.mock("@/components/SyncProvider", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="sync-provider">{children}</div>,
}));

vi.mock("@/components/EconCalAlerts", () => ({
  default: () => <div data-testid="econcal-alerts" />,
}));

vi.mock("@/lib/sidebar/provider", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="sidebar-provider">{children}</div>,
}));

describe("DashboardLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when there is no session", async () => {
    (getSession as any).mockResolvedValue(null);

    await expect(
      DashboardLayout({ children: <div>content</div> })
    ).rejects.toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("renders nav and children when session exists", async () => {
    (getSession as any).mockResolvedValue({ email: "user@example.com" });
    (isAdminSession as any).mockReturnValue(true);

    const ui = await DashboardLayout({ children: <div data-testid="child">content</div> });
    render(ui as React.ReactElement);

    expect(screen.getByTestId("dashboard-nav")).toHaveTextContent("user@example.com-true");
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
