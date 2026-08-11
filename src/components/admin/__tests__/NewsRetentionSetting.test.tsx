import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import NewsRetentionSetting from "../NewsRetentionSetting";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    locale: "ru",
    timezone: "auto",
    setLocale: vi.fn(),
    setTimezone: vi.fn(),
  }),
}));

function input() {
  return screen.getByLabelText("admin.content.retentionLabel") as HTMLInputElement;
}
function saveButton() {
  return screen.getByRole("button", { name: "admin.content.save" });
}

describe("NewsRetentionSetting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
  });

  it("shows the current value and keeps save disabled until it changes", () => {
    render(<NewsRetentionSetting value={2} max={365} />);
    expect(input().value).toBe("2");
    expect(saveButton()).toBeDisabled();
  });

  it("saves the new value through PATCH and refreshes the page", async () => {
    render(<NewsRetentionSetting value={2} max={365} />);
    fireEvent.change(input(), { target: { value: "7" } });
    expect(saveButton()).not.toBeDisabled();
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText("admin.content.saved")).toBeInTheDocument());
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/content");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ feed: "news", retentionDays: 7 });
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses to save a value above the maximum", () => {
    render(<NewsRetentionSetting value={2} max={365} />);
    fireEvent.change(input(), { target: { value: "9999" } });
    expect(saveButton()).toBeDisabled();
    fireEvent.click(saveButton());
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refuses to save a negative or non-numeric value", () => {
    render(<NewsRetentionSetting value={2} max={365} />);
    for (const bad of ["-1", "abc", ""]) {
      fireEvent.change(input(), { target: { value: bad } });
      expect(saveButton()).toBeDisabled();
    }
  });

  it("warns that nothing will be deleted when set to 0", () => {
    render(<NewsRetentionSetting value={2} max={365} />);
    expect(screen.getByText("admin.content.retentionHint")).toBeInTheDocument();
    fireEvent.change(input(), { target: { value: "0" } });
    expect(screen.getByText("admin.content.retentionHintOff")).toBeInTheDocument();
  });

  it("surfaces a server error instead of claiming success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Проверьте данные" }),
    });
    render(<NewsRetentionSetting value={2} max={365} />);
    fireEvent.change(input(), { target: { value: "7" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText("Проверьте данные")).toBeInTheDocument());
    expect(screen.queryByText("admin.content.saved")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("surfaces a network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    render(<NewsRetentionSetting value={2} max={365} />);
    fireEvent.change(input(), { target: { value: "7" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText("offline")).toBeInTheDocument());
  });
});
