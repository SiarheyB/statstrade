import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { prisma } from "@/lib/db";
import AdminSystemPage from "../page";

vi.mock("@/lib/i18n/server", () => ({
  getServerT: async () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    locale: "ru",
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

describe("AdminSystemPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders table rows with formatted size and row counts", async () => {
    (prisma.$queryRaw as any).mockResolvedValue([
      { table: "Fill", rows: BigInt(12000), bytes: BigInt(2_500_000) },
      { table: "User", rows: BigInt(50), bytes: BigInt(10_000) },
    ]);

    const ui = await AdminSystemPage();
    render(ui as React.ReactElement);

    expect(screen.getByText("admin.system.title")).toBeInTheDocument();
    expect(screen.getByText("Fill")).toBeInTheDocument();
    expect(screen.getByText("User")).toBeInTheDocument();
    expect(screen.getAllByText("2.4 MB").length).toBeGreaterThan(0);
  });

  it("renders error message when the query fails", async () => {
    (prisma.$queryRaw as any).mockRejectedValue(new Error("db down"));

    const ui = await AdminSystemPage();
    render(ui as React.ReactElement);

    expect(screen.getByText("db down")).toBeInTheDocument();
  });
});
