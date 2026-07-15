import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: (k: string) => k, setLocale: vi.fn(), locale: "en", timezone: "auto", setTimezone: vi.fn() }),
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import DonateButton from "@/components/DonateButton";

const wallets = [
  { id: "1", network: "ERC20", coin: "USDT", address: "0xABCDEF", qr: "/qr/usdt.png" },
];

describe("DonateButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the donate trigger", () => {
    render(<DonateButton />);
    expect(screen.getByText("nav.donate")).toBeInTheDocument();
  });

  it("opens the modal and loads wallets from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ wallets }) }),
    );
    render(<DonateButton />);
    fireEvent.click(screen.getByText("nav.donate"));
    expect(await screen.findByText("USDT · ERC20")).toBeInTheDocument();
    expect(screen.getByText("0xABCDEF")).toBeInTheDocument();
  });

  it("shows empty state when no wallets are returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ wallets: [] }) }),
    );
    render(<DonateButton />);
    fireEvent.click(screen.getByText("nav.donate"));
    expect(await screen.findByText("donate.empty")).toBeInTheDocument();
  });

  it("copies the wallet address to clipboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ wallets }) }),
    );
    render(<DonateButton />);
    fireEvent.click(screen.getByText("nav.donate"));
    const copyBtn = await screen.findByTitle("donate.copy");
    fireEvent.click(copyBtn);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("0xABCDEF"));
  });
});
