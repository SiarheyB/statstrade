import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ImagePreviewModal from "@/components/ImagePreviewModal";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "ru", timezone: "auto" }),
}));

describe("ImagePreviewModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the image", () => {
    const { container } = render(<ImagePreviewModal url="https://example.com/img.png" onClose={() => {}} />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.src).toBe("https://example.com/img.png");
  });

  it("calls onClose when the background is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<ImagePreviewModal url="https://example.com/img.png" onClose={onClose} />);
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<ImagePreviewModal url="https://example.com/img.png" onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("common.close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(<ImagePreviewModal url="https://example.com/img.png" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows unavailable message when the image fails to load", () => {
    const { container } = render(<ImagePreviewModal url="https://example.com/broken.png" onClose={() => {}} />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(screen.getByText("trades.image.unavailable")).toBeInTheDocument();
  });

  it("zooms in when clicking the zoom-in button and shows reset button", () => {
    render(<ImagePreviewModal url="https://example.com/img.png" onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("trades.image.zoomIn"));
    expect(screen.getByText("140%")).toBeInTheDocument();
    expect(screen.getByLabelText("trades.image.zoomReset")).toBeInTheDocument();
  });

  it("resets zoom when clicking the reset button", () => {
    render(<ImagePreviewModal url="https://example.com/img.png" onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("trades.image.zoomIn"));
    fireEvent.click(screen.getByLabelText("trades.image.zoomReset"));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
