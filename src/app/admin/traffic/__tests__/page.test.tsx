import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminTrafficPage from "../page";
import type { TrafficReport } from "@/lib/traffic/report";

vi.mock("@/lib/i18n/server", () => ({
  getServerT: async () => ({ t: (k: string) => k, locale: "ru" }),
  getTimezone: async () => "UTC+3",
}));

vi.mock("@/components/admin/TrafficLive", () => ({
  default: () => <div data-testid="live" />,
}));

const report = (over: Partial<TrafficReport> = {}): TrafficReport => ({
  range: { from: "2026-08-12T00:00:00.000Z", to: "2026-08-19T10:00:00.000Z", bucket: "day" },
  totals: { views: 120, sessions: 40, visitors: 30, botViews: 20, botSessions: 8, humanViews: 100, humanVisitors: 25 },
  sessions: {
    sessions: 32, bounces: 8, bounceRate: 0.25, avgDurationSec: 95, viewsPerSession: 3.1,
    registered: 2, loggedIn: 5, jsConfirmed: 28, newVisitors: 18,
  },
  deltas: { views: 0.2, visitors: -0.1, sessions: null },
  series: [{ bucket: "2026-08-18T00:00:00.000Z", humanViews: 40, humanVisitors: 12, botViews: 10 }],
  pages: [{ path: "/", views: 60, visitors: 20, entries: 18, bounceRate: 0.3 }],
  sources: [{ source: "search", refHost: "google.com", sessions: 12, visitors: 10, bounceRate: 0.2, registered: 1 }],
  campaigns: [{ utmSource: "telegram", utmMedium: "post", utmCampaign: "launch", sessions: 5, registered: 1 }],
  devices: [{ key: "desktop", sessions: 20, share: 0.8 }],
  browsers: [{ key: "Chrome", sessions: 18, share: 0.72 }],
  systems: [{ key: "Windows 10/11", sessions: 15, share: 0.6 }],
  langs: [{ key: "ru", sessions: 22, share: 0.9 }],
  countries: [{ key: "—", sessions: 22, share: 1 }],
  bots: [{ name: "Googlebot", category: "search", views: 12, sessions: 3, lastSeen: "2026-08-19T09:00:00.000Z", topPath: "/news" }],
  visits: [{
    id: "s1", startedAt: "2026-08-19T09:30:00.000Z", lastSeenAt: "2026-08-19T09:35:00.000Z", views: 3,
    entryPath: "/", exitPath: "/register", source: "search", refHost: "google.com", device: "desktop",
    browser: "Chrome", os: "Windows 10/11", country: null, lang: "ru", isBot: false, botName: null,
    jsConfirmed: true, registered: true, loggedIn: false, authed: true, userAgent: "UA",
  }],
  live: { visitors: 2, views: 5, pages: [{ path: "/", visitors: 2 }], lastHitAt: "2026-08-19T09:59:00.000Z" },
  ...over,
});

const mockReport = vi.fn();
vi.mock("@/lib/traffic/report", () => ({ getTrafficReport: (...a: unknown[]) => mockReport(...a) }));

describe("AdminTrafficPage", () => {
  it("показывает основные цифры, источники, роботов и визиты", async () => {
    mockReport.mockResolvedValue(report());
    render((await AdminTrafficPage({ searchParams: Promise.resolve({}) })) as React.ReactElement);

    expect(screen.getByText("admin.traffic.title")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument(); // уникальные посетители
    expect(screen.getByText("Googlebot")).toBeInTheDocument();
    expect(screen.getAllByText(/google\.com/).length).toBeGreaterThan(0);
    expect(screen.getByText("/register")).toBeInTheDocument();
    expect(screen.getByTestId("live")).toBeInTheDocument();
  });

  it("период и аудитория читаются из URL", async () => {
    mockReport.mockResolvedValue(report());
    render((await AdminTrafficPage({ searchParams: Promise.resolve({ p: "30d", a: "bot" }) })) as React.ReactElement);
    // UTC+3 → смещение 180 минут уходит в запрос вместе с периодом и аудиторией.
    expect(mockReport).toHaveBeenLastCalledWith("30d", 180, "bot");
  });

  it("мусор в параметрах не ломает страницу — берутся значения по умолчанию", async () => {
    mockReport.mockResolvedValue(report());
    render((await AdminTrafficPage({ searchParams: Promise.resolve({ p: "хакер", a: "хакер" }) })) as React.ReactElement);
    expect(mockReport).toHaveBeenLastCalledWith("7d", 180, "human");
  });

  it("предупреждает, когда сбор данных остановился", async () => {
    mockReport.mockResolvedValue(report({ live: { visitors: 0, views: 0, pages: [], lastHitAt: null } }));
    render((await AdminTrafficPage({ searchParams: Promise.resolve({}) })) as React.ReactElement);
    expect(screen.getByText("admin.traffic.noData")).toBeInTheDocument();
  });
});
