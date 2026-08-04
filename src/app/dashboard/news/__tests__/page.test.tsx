import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import NewsPage from "../page";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string, params?: Record<string, unknown>) =>
      params ? `${k}:${JSON.stringify(params)}` : k,
    locale: "ru",
    timezone: "auto",
    setLocale: vi.fn(),
    setTimezone: vi.fn(),
  }),
}));

const mockItems = [
  {
    id: "1",
    source: "src-a",
    title: "First news item",
    url: "https://example.com/1",
    summary: "Summary one",
    imageUrl: "https://example.com/img1.png",
    publishedAt: new Date().toISOString(),
  },
  {
    id: "2",
    source: "src-b",
    title: "Second news item",
    url: "https://example.com/2",
    summary: null,
    imageUrl: null,
    publishedAt: new Date().toISOString(),
  },
];

const mockSources = [
  { id: "src-a", name: "Source A" },
  { id: "src-b", name: "Source B" },
];

function mockFetchOk(items = mockItems, sources = mockSources) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ items, sources }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NewsPage", () => {
  it("renders loading state initially", () => {
    mockFetchOk();
    render(<NewsPage />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("renders news items after load", async () => {
    mockFetchOk();
    render(<NewsPage />);
    expect(await screen.findByText("First news item")).toBeInTheDocument();
    expect(screen.getByText("Second news item")).toBeInTheDocument();
    expect(screen.getByText("Summary one")).toBeInTheDocument();
  });

  it("renders empty state when no items", async () => {
    mockFetchOk([], []);
    render(<NewsPage />);
    expect(await screen.findByText("news.empty")).toBeInTheDocument();
  });

  it("does not blow up when fetch response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
    render(<NewsPage />);
    await waitFor(() => expect(screen.queryByText("common.loading")).not.toBeInTheDocument());
    expect(screen.getByText("news.empty")).toBeInTheDocument();
  });

  it("filters items by source tab", async () => {
    mockFetchOk();
    render(<NewsPage />);
    await screen.findByText("First news item");

    fireEvent.click(screen.getAllByText("Source A")[0]);

    expect(screen.getByText("First news item")).toBeInTheDocument();
    expect(screen.queryByText("Second news item")).not.toBeInTheDocument();
  });

  it("triggers a forced refresh when clicking refresh button", async () => {
    mockFetchOk();
    render(<NewsPage />);
    await screen.findByText("First news item");

    const refreshBtn = screen.getByText("news.refresh").closest("button")!;
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining("refresh=1"),
      );
    });
  });
});
