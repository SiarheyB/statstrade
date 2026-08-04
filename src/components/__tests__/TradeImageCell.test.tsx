import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TradeImageCell from "@/components/TradeImageCell";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "ru", timezone: "auto" }),
}));

const baseProps = {
  tradeKey: "trade1",
  symbol: "BTCUSDT",
  entryTime: "2024-01-01T00:00:00Z",
  result: "win",
  pattern: null as string | null,
  imageUrl: null as string | null,
  imageProvider: null as string | null,
  connected: true,
  onUploaded: vi.fn(),
  onDeleted: vi.fn(),
  onPreview: vi.fn(),
};

describe("TradeImageCell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a connect hint link when no provider is connected", () => {
    render(<TradeImageCell {...baseProps} connected={false} />);
    expect(screen.getByText("trades.image.connectHint")).toBeInTheDocument();
  });

  it("shows upload button when connected with no image", () => {
    render(<TradeImageCell {...baseProps} />);
    expect(screen.getByText("trades.image.upload")).toBeInTheDocument();
  });

  it("uploads a file and calls onUploaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ imageUrl: "https://x/img.png", imageProvider: "google_drive", imagePublicUrl: null }),
      }),
    );
    const onUploaded = vi.fn();
    const { container } = render(<TradeImageCell {...baseProps} onUploaded={onUploaded} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["hello"], "shot.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("https://x/img.png", "google_drive", null));
  });

  it("shows error when file is too large", async () => {
    const { container } = render(<TradeImageCell {...baseProps} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const bigFile = new File([new Uint8Array(11 * 1024 * 1024)], "big.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [bigFile] } });
    expect(await screen.findByText("trades.image.tooLarge")).toBeInTheDocument();
  });

  it("shows error message on failed upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "Quota exceeded" }) }),
    );
    const { container } = render(<TradeImageCell {...baseProps} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["hello"], "shot.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText("Quota exceeded")).toBeInTheDocument();
  });

  it("shows the image label and calls onPreview when clicked", () => {
    const onPreview = vi.fn();
    render(
      <TradeImageCell
        {...baseProps}
        imageUrl="https://example.com/image.png"
        imageProvider="google_drive"
        onPreview={onPreview}
      />,
    );
    const previewBtn = screen.getByText("Google Drive");
    fireEvent.click(previewBtn);
    expect(onPreview).toHaveBeenCalledWith("https://example.com/image.png");
  });

  it("calls onDeleted after successful delete", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
    const onDeleted = vi.fn();
    render(
      <TradeImageCell
        {...baseProps}
        imageUrl="https://example.com/image.png"
        imageProvider="google_drive"
        onDeleted={onDeleted}
      />,
    );
    fireEvent.click(screen.getByLabelText("trades.image.remove"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/trade-images?tradeKey=trade1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
