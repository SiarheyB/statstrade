import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: (k: string) => k, setLocale: vi.fn(), locale: "en", timezone: "auto", setTimezone: vi.fn() }),
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import SupportButton from "@/components/SupportButton";

function fetchMock() {
  return vi.fn((url: string) => {
    if (url.includes("/unread")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 0 }) });
    if (url === "/api/support") return Promise.resolve({ ok: true, json: () => Promise.resolve({ tickets: [] }) });
    if (url.startsWith("/api/support/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ticket: { subject: "Hi" }, messages: [], status: "open" }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

describe("SupportButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the support trigger", () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<SupportButton />);
    expect(screen.getByText("nav.support")).toBeInTheDocument();
  });

  it("opens the modal and shows the empty-thread subtitle", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<SupportButton />);
    fireEvent.click(screen.getByText("nav.support"));
    expect(await screen.findByText("support.subtitle")).toBeInTheDocument();
  });

  it("switches to the new-ticket composer", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<SupportButton />);
    fireEvent.click(screen.getByText("nav.support"));
    await screen.findByText("support.subtitle");
    fireEvent.click(screen.getByText("support.new"));
    // The composer textarea becomes available in the "new" view.
    await waitFor(() => expect(screen.getByPlaceholderText("support.placeholder")).toBeInTheDocument());
  });
});
