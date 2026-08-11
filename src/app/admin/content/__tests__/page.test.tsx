import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { prisma } from "@/lib/db";
import AdminContentPage from "../page";

vi.mock("@/lib/i18n/server", () => ({
  getServerT: async () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    locale: "ru",
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    newsItem: { count: vi.fn(), findFirst: vi.fn() },
    economicEvent: { count: vi.fn(), findFirst: vi.fn() },
    // Нет строки = фича «Новости» включена с дефолтным retentionDays.
    featureConfig: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock("@/components/admin/ContentActions", () => ({
  default: ({ feed }: { feed: string }) => <div data-testid={`content-actions-${feed}`} />,
}));

describe("AdminContentPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.newsItem.count as any).mockResolvedValue(100);
    (prisma.economicEvent.count as any).mockResolvedValue(50);
  });

  it("renders news and econcal cards with totals", async () => {
    (prisma.newsItem.findFirst as any).mockResolvedValue({ createdAt: new Date("2024-01-01") });
    (prisma.economicEvent.findFirst as any)
      .mockResolvedValueOnce({ updatedAt: new Date("2024-01-02") })
      .mockResolvedValueOnce({ title: "NFP", time: new Date("2024-02-01") });

    const ui = await AdminContentPage();
    render(ui as React.ReactElement);

    expect(screen.getByText("admin.content.title")).toBeInTheDocument();
    expect(screen.getByText("admin.content.news")).toBeInTheDocument();
    expect(screen.getByText("admin.content.econcal")).toBeInTheDocument();
    expect(screen.getByTestId("content-actions-news")).toBeInTheDocument();
    expect(screen.getByTestId("content-actions-econcal")).toBeInTheDocument();
  });

  it("renders with no last update / no next event data", async () => {
    (prisma.newsItem.findFirst as any).mockResolvedValue(null);
    (prisma.economicEvent.findFirst as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const ui = await AdminContentPage();
    render(ui as React.ReactElement);

    expect(screen.getAllByText(/admin.content.lastUpdate/).length).toBe(2);
  });
});
