import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import AdminUserDetailPage from "../page";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    locale: "ru",
    timezone: "auto",
    setLocale: vi.fn(),
    setTimezone: vi.fn(),
  }),
}));

vi.mock("@/lib/i18n/server", () => ({
  getServerT: async () => ({
    t: (k: string, params?: Record<string, unknown>) =>
      params ? `${k}:${JSON.stringify(params)}` : k,
    locale: "ru",
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminEmail: vi.fn(() => false),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    adminAudit: { findMany: vi.fn() },
    // Игровой профиль есть не у каждого пользователя — по умолчанию его нет.
    gamePlayer: { findUnique: vi.fn() },
  },
}));

const baseUser = {
  id: "user-1",
  email: "trader@example.com",
  name: "Trader Joe",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  twoFactorEnabled: false,
  googleId: null,
  password: "hash",
  _count: { accounts: 1, annotations: 3 },
  cloudStorageAccounts: [],
  accounts: [
    {
      id: "acc-1",
      exchange: "Binance",
      label: "Main",
      source: "api",
      marketType: "spot",
      syncStatus: "idle",
      syncError: null,
      lastSyncAt: new Date("2024-02-01T00:00:00Z"),
      autoSync: true,
      balance: 1234.5,
      _count: { fills: 10, importedTrades: 2 },
    },
  ],
};

describe("AdminUserDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders user details, accounts table and audit history", async () => {
    (prisma.gamePlayer.findUnique as any).mockResolvedValue(null);
    (prisma.user.findUnique as any).mockResolvedValue(baseUser);
    (prisma.adminAudit.findMany as any).mockResolvedValue([
      {
        id: "audit-1",
        actorEmail: "admin@example.com",
        action: "reset_2fa",
        detail: "manual",
        createdAt: new Date("2024-03-01T00:00:00Z"),
      },
    ]);

    const ui = await AdminUserDetailPage({ params: Promise.resolve({ id: "user-1" }) });
    render(ui as React.ReactElement);

    // Карточка разделена на вкладки: биржи и история действий живут в своих
    // разделах, поэтому до них нужно дойти.
    expect(screen.getByText("trader@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByText("admin.userDetail.tab.accounts"));
    expect(screen.getByText("Binance")).toBeInTheDocument();
    fireEvent.click(screen.getByText("admin.userDetail.tab.history"));
    expect(screen.getByText("admin@example.com", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/reset_2fa/)).toBeInTheDocument();
  });

  it("renders empty accounts and empty history states", async () => {
    (prisma.user.findUnique as any).mockResolvedValue({
      ...baseUser,
      accounts: [],
      cloudStorageAccounts: [],
    });
    (prisma.adminAudit.findMany as any).mockResolvedValue([]);

    const ui = await AdminUserDetailPage({ params: Promise.resolve({ id: "user-1" }) });
    render(ui as React.ReactElement);

    fireEvent.click(screen.getByText("admin.userDetail.tab.accounts"));
    expect(screen.getByText("admin.userDetail.noAccounts")).toBeInTheDocument();
    fireEvent.click(screen.getByText("admin.userDetail.tab.history"));
    expect(screen.getByText("admin.userDetail.noHistory")).toBeInTheDocument();
  });

  it("shows cloud storage badges and admin shield when applicable", async () => {
    const { isAdminEmail } = await import("@/lib/admin");
    (isAdminEmail as any).mockReturnValue(true);
    (prisma.user.findUnique as any).mockResolvedValue({
      ...baseUser,
      googleId: "g-123",
      twoFactorEnabled: true,
      cloudStorageAccounts: [{ provider: "google_drive", accountEmail: "gd@example.com" }],
    });
    (prisma.adminAudit.findMany as any).mockResolvedValue([]);

    const ui = await AdminUserDetailPage({ params: Promise.resolve({ id: "user-1" }) });
    render(ui as React.ReactElement);

    expect(screen.getByText("Google Drive")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
  });

  it("calls notFound when user does not exist", async () => {
    (prisma.user.findUnique as any).mockResolvedValue(null);

    await expect(
      AdminUserDetailPage({ params: Promise.resolve({ id: "missing" }) })
    ).rejects.toThrow("NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("во вкладке «Игра» показывает игровой профиль, а без него — честное «не заходил»", async () => {
    (prisma.user.findUnique as any).mockResolvedValue(baseUser);
    (prisma.adminAudit.findMany as any).mockResolvedValue([]);
    (prisma.gamePlayer.findUnique as any).mockResolvedValue(null);
    const empty = await AdminUserDetailPage({ params: Promise.resolve({ id: "user-1" }) });
    render(empty as React.ReactElement);
    fireEvent.click(screen.getByText("admin.userDetail.tab.game"));
    expect(screen.getByText(/ещё не заходил в игру/)).toBeInTheDocument();
  });

  it("во вкладке «Игра» видно снимок клиента и очередь получения", async () => {
    (prisma.user.findUnique as any).mockResolvedValue(baseUser);
    (prisma.adminAudit.findMany as any).mockResolvedValue([]);
    (prisma.gamePlayer.findUnique as any).mockResolvedValue({
      nickname: "ONYX",
      rankKey: "pro",
      prestige: 70,
      level: 3,
      equity: 2_068,
      peakEquity: 190_000,
      contractsPassed: 2,
      bestContractPct: 8.5,
      reliability: 100,
      activeStyle: "day",
      gameDay: 12,
      pendingPayout: 500,
      isPublic: true,
      mutedUntil: null,
      fundName: null,
      lastSyncAt: new Date("2026-09-05T12:00:00Z"),
      seasonStartEquity: 10_000,
    });
    const ui = await AdminUserDetailPage({ params: Promise.resolve({ id: "user-1" }) });
    render(ui as React.ReactElement);
    fireEvent.click(screen.getByText("admin.userDetail.tab.game"));
    expect(screen.getByText("ONYX")).toBeInTheDocument();
    // Сезонный результат считается от эквити на входе в сезон, а не от нуля.
    expect(screen.getByText("-79.32%")).toBeInTheDocument();
  });
});
