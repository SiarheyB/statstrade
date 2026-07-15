import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: (k: string) => k, setLocale: vi.fn(), locale: "en", timezone: "auto", setTimezone: vi.fn() }),
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import DashboardNav from "@/components/DashboardNav";

function fetchMock() {
  return vi.fn((url: string) => {
    if (url.includes("/features")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ value: { enabled: true } }) });
    if (url.includes("/unread")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 0 }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

describe("DashboardNav", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the brand, user email and core nav links", () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<DashboardNav email="user@example.com" />);
    expect(screen.getAllByText("TradeStats").length).toBeGreaterThan(0);
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByText("nav.overview")).toBeInTheDocument();
    expect(screen.getByText("nav.news")).toBeInTheDocument();
    expect(screen.getByText("nav.logout")).toBeInTheDocument();
  });

  it("hides the admin link for non-admins", () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<DashboardNav email="user@example.com" />);
    expect(screen.queryByText("nav.admin")).not.toBeInTheDocument();
  });

  it("shows the admin link for admins", () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<DashboardNav email="admin@example.com" isAdmin />);
    expect(screen.getByText("nav.admin")).toBeInTheDocument();
  });
});
