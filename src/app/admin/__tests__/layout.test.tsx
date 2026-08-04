import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/admin";
import AdminLayout from "../layout";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/lib/admin", () => ({
  getAdminSession: vi.fn(),
}));

vi.mock("@/components/AdminNav", () => ({
  default: ({ email }: { email: string }) => <div data-testid="admin-nav">{email}</div>,
}));

vi.mock("@/lib/sidebar/provider", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="sidebar-provider">{children}</div>,
}));

describe("AdminLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls notFound when there is no admin session", async () => {
    (getAdminSession as any).mockResolvedValue(null);

    await expect(
      AdminLayout({ children: <div>content</div> })
    ).rejects.toThrow("NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("renders nav and children when admin session exists", async () => {
    (getAdminSession as any).mockResolvedValue({ email: "admin@example.com" });

    const ui = await AdminLayout({ children: <div data-testid="child">content</div> });
    render(ui as React.ReactElement);

    expect(screen.getByTestId("admin-nav")).toHaveTextContent("admin@example.com");
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
