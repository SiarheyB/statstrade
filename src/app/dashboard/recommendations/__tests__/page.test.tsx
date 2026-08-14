import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isAdminSession } from "@/lib/admin";
import { getFeatureConfig } from "@/lib/featureConfig";
import RecommendationsPage from "../page";

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

vi.mock("@/lib/featureConfig", () => ({
  getFeatureConfig: vi.fn(),
}));

vi.mock("../RecommendationsView", () => ({
  default: () => <div data-testid="recommendations-view">RecommendationsView</div>,
}));

describe("RecommendationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when there is no session", async () => {
    (getSession as any).mockResolvedValue(null);

    await expect(RecommendationsPage()).rejects.toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("shows access denied when the feature is disabled globally", async () => {
    (getSession as any).mockResolvedValue({ email: "user@example.com" });
    (isAdminSession as any).mockReturnValue(false);
    (getFeatureConfig as any).mockImplementation((key: string) =>
      Promise.resolve(key === "tradeRecommendations" ? { enabled: false } : { enabled: true })
    );

    const ui = await RecommendationsPage();
    render(ui as React.ReactElement);
    expect(screen.getByText("Доступ запрещён")).toBeInTheDocument();
    expect(
      screen.getByText("Раздел «Рекомендации» временно отключён администратором.")
    ).toBeInTheDocument();
  });

  it("shows access denied for non-admin when public access is disabled", async () => {
    (getSession as any).mockResolvedValue({ email: "user@example.com" });
    (isAdminSession as any).mockReturnValue(false);
    (getFeatureConfig as any).mockImplementation((key: string) =>
      Promise.resolve(key === "tradeRecommendations" ? { enabled: true } : { enabled: false })
    );

    const ui = await RecommendationsPage();
    render(ui as React.ReactElement);
    expect(
      screen.getByText("Раздел «Рекомендации» пока недоступен для обычных пользователей.")
    ).toBeInTheDocument();
  });

  it("renders RecommendationsView when enabled for the user", async () => {
    (getSession as any).mockResolvedValue({ email: "user@example.com" });
    (isAdminSession as any).mockReturnValue(false);
    (getFeatureConfig as any).mockResolvedValue({ enabled: true });

    const ui = await RecommendationsPage();
    render(ui as React.ReactElement);
    expect(screen.getByTestId("recommendations-view")).toBeInTheDocument();
  });

  it("renders RecommendationsView for admin even when public access is disabled", async () => {
    (getSession as any).mockResolvedValue({ email: "admin@example.com" });
    (isAdminSession as any).mockReturnValue(true);
    (getFeatureConfig as any).mockImplementation((key: string) =>
      Promise.resolve(key === "tradeRecommendations" ? { enabled: true } : { enabled: false })
    );

    const ui = await RecommendationsPage();
    render(ui as React.ReactElement);
    expect(screen.getByTestId("recommendations-view")).toBeInTheDocument();
  });
});
