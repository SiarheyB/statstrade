import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { prisma } from "@/lib/db";
import AdminAuditPage from "../page";

vi.mock("@/lib/i18n/server", () => ({
  getServerT: async () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    locale: "ru",
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    adminAudit: { findMany: vi.fn() },
  },
}));

describe("AdminAuditPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders audit rows", async () => {
    (prisma.adminAudit.findMany as any).mockResolvedValue([
      {
        id: "1",
        actorEmail: "admin@example.com",
        action: "reset_2fa",
        targetLabel: "user@example.com",
        targetType: "user",
        detail: "manual reset",
        createdAt: new Date("2024-01-01T00:00:00Z"),
      },
    ]);

    const ui = await AdminAuditPage();
    render(ui as React.ReactElement);

    expect(screen.getByText("admin.audit.title")).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByText("reset_2fa")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByText("manual reset")).toBeInTheDocument();
  });

  it("renders empty state when there are no rows", async () => {
    (prisma.adminAudit.findMany as any).mockResolvedValue([]);

    const ui = await AdminAuditPage();
    render(ui as React.ReactElement);

    expect(screen.getByText("admin.audit.empty")).toBeInTheDocument();
  });
});
