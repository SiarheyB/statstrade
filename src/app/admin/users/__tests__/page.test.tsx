import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { prisma } from "@/lib/db";
import AdminUsersPage from "../page";

vi.mock("@/lib/i18n/server", () => ({
  getServerT: async () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    locale: "ru",
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminEmail: vi.fn(() => false),
  ONLINE_THRESHOLD_MS: 5 * 60_000,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findMany: vi.fn() },
  },
}));

vi.mock("@/components/admin/UsersTable", () => ({
  default: ({ rows }: { rows: any[] }) => <div data-testid="users-table">{rows.length}</div>,
}));

describe("AdminUsersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps users and renders the users table", async () => {
    (prisma.user.findMany as any).mockResolvedValue([
      {
        id: "u1",
        email: "user@example.com",
        name: "User One",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        lastSeenAt: new Date(),
        lastActiveAt: new Date(),
        twoFactorEnabled: true,
        googleId: "g-1",
        _count: { accounts: 2, annotations: 1 },
        cloudStorageAccounts: [{ provider: "google_drive", accountEmail: "gd@example.com" }],
      },
    ]);

    const ui = await AdminUsersPage();
    render(ui as React.ReactElement);

    expect(screen.getByText("admin.users.title")).toBeInTheDocument();
    expect(screen.getByTestId("users-table")).toHaveTextContent("1");
  });
});
