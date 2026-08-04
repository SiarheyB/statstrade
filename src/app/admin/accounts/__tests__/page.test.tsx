import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { prisma } from "@/lib/db";
import AdminAccountsPage from "../page";

vi.mock("@/lib/i18n/server", () => ({
  getServerT: async () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    locale: "ru",
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    exchangeAccount: { findMany: vi.fn() },
  },
}));

vi.mock("@/components/admin/AccountsTable", () => ({
  default: ({ rows }: { rows: any[] }) => <div data-testid="accounts-table">{rows.length}</div>,
}));

describe("AdminAccountsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps accounts and renders the accounts table", async () => {
    (prisma.exchangeAccount.findMany as any).mockResolvedValue([
      {
        id: "acc1",
        exchange: "binance",
        label: "Main",
        source: "api",
        marketType: "spot",
        syncStatus: "idle",
        syncError: null,
        lastSyncAt: new Date("2024-01-01T00:00:00Z"),
        autoSync: true,
        syncIntervalMinutes: 5,
        user: { email: "user@example.com" },
        _count: { fills: 10, importedTrades: 2 },
      },
    ]);

    const ui = await AdminAccountsPage();
    render(ui as React.ReactElement);

    expect(screen.getByText("admin.accounts.title")).toBeInTheDocument();
    expect(screen.getByTestId("accounts-table")).toHaveTextContent("1");
  });
});
