import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import MentorShareSettings from "@/components/MentorShareSettings";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string, vars?: Record<string, string | number>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    locale: "ru",
    timezone: "auto",
  }),
}));

function mockFetch(featureEnabled: boolean, links: Array<Record<string, unknown>> = []) {
  const fn = vi.fn((url: string) => {
    if (url.includes("/api/features")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ value: { enabled: featureEnabled, maxLinksPerUser: 5 } }),
      });
    }
    if (url.includes("/api/share-links")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ links }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("MentorShareSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("confirm", vi.fn(() => true));
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders nothing when the feature is disabled", async () => {
    mockFetch(false);
    const { container } = await act(async () => render(<MentorShareSettings />));
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("renders the create form when the feature is enabled", async () => {
    mockFetch(true);
    await act(async () => {
      render(<MentorShareSettings />);
    });
    expect(await screen.findByText("mentor.title")).toBeInTheDocument();
    expect(screen.getByText("mentor.empty")).toBeInTheDocument();
  });

  it("creates a share link", async () => {
    const fetchMock = mockFetch(true);
    await act(async () => {
      render(<MentorShareSettings />);
    });
    await screen.findByText("mentor.title");

    // After creation, load() is called again returning a link
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/features")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ value: { enabled: true, maxLinksPerUser: 5 } }),
        });
      }
      if (url.includes("/api/share-links") && !url.includes("?")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ links: [{ id: "l1", token: "tok1", label: "My mentor", createdAt: "", lastViewedAt: null }] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    fireEvent.change(screen.getByPlaceholderText("mentor.labelPlaceholder"), { target: { value: "My mentor" } });
    await act(async () => {
      fireEvent.click(screen.getByText("mentor.create"));
    });

    expect(await screen.findByText("My mentor")).toBeInTheDocument();
  });

  it("copies the link to clipboard", async () => {
    mockFetch(true, [{ id: "l1", token: "tok1", label: "Mentor A", createdAt: "", lastViewedAt: null }]);
    await act(async () => {
      render(<MentorShareSettings />);
    });
    const copyBtn = await screen.findByTitle("mentor.copy");
    fireEvent.click(copyBtn);
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/share/tok1")),
    );
  });

  it("revokes a link after confirmation", async () => {
    const fetchMock = mockFetch(true, [{ id: "l1", token: "tok1", label: "Mentor A", createdAt: "", lastViewedAt: null }]);
    await act(async () => {
      render(<MentorShareSettings />);
    });
    const revokeBtn = await screen.findByTitle("mentor.revoke");
    await act(async () => {
      fireEvent.click(revokeBtn);
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/share-links?id=l1"), expect.objectContaining({ method: "DELETE" }));
  });
});
