import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import TwoFactorSettings from "@/components/TwoFactorSettings";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "ru", timezone: "auto" }),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <img alt={props.alt as string} src={props.src as string} />,
}));

function mockFetchSequence(responses: Array<{ ok: boolean; json: unknown }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockImplementationOnce(() => Promise.resolve({ ok: r.ok, json: () => Promise.resolve(r.json) }));
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("TwoFactorSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows enable button when 2FA is disabled", async () => {
    mockFetchSequence([{ ok: true, json: { enabled: false } }]);
    await act(async () => {
      render(<TwoFactorSettings />);
    });
    expect(await screen.findByText("settings.twoFactor.enable")).toBeInTheDocument();
  });

  it("shows disable button and 'on' badge when 2FA is enabled", async () => {
    mockFetchSequence([{ ok: true, json: { enabled: true } }]);
    await act(async () => {
      render(<TwoFactorSettings />);
    });
    expect(await screen.findByText("settings.twoFactor.disable")).toBeInTheDocument();
    expect(screen.getByText("settings.twoFactor.on")).toBeInTheDocument();
  });

  it("enable flow shows QR/secret and confirms with code", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { enabled: false } },
      { ok: true, json: { secret: "SECRET123", otpauth: "otpauth://x", qr: "data:image/png;base64,aaa" } },
      { ok: true, json: {} },
    ]);
    await act(async () => {
      render(<TwoFactorSettings />);
    });
    await screen.findByText("settings.twoFactor.enable");
    await act(async () => {
      fireEvent.click(screen.getByText("settings.twoFactor.enable"));
    });
    expect(await screen.findByText("SECRET123")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
    await act(async () => {
      fireEvent.click(screen.getByText("settings.twoFactor.confirm"));
    });

    await waitFor(() => expect(screen.getByText("settings.twoFactor.on")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/auth/2fa/confirm",
      expect.objectContaining({ body: JSON.stringify({ code: "123456" }) }),
    );
  });

  it("shows error when confirm fails", async () => {
    mockFetchSequence([
      { ok: true, json: { enabled: false } },
      { ok: true, json: { secret: "SECRET123", otpauth: "otpauth://x", qr: "data:image/png;base64,aaa" } },
      { ok: false, json: { error: "Invalid code" } },
    ]);
    await act(async () => {
      render(<TwoFactorSettings />);
    });
    await screen.findByText("settings.twoFactor.enable");
    await act(async () => {
      fireEvent.click(screen.getByText("settings.twoFactor.enable"));
    });
    await screen.findByText("SECRET123");
    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
    await act(async () => {
      fireEvent.click(screen.getByText("settings.twoFactor.confirm"));
    });
    expect(await screen.findByText("Invalid code")).toBeInTheDocument();
  });

  it("disable flow calls DELETE with code and clears enabled state", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { enabled: true } },
      { ok: true, json: {} },
    ]);
    await act(async () => {
      render(<TwoFactorSettings />);
    });
    await screen.findByText("settings.twoFactor.disable");
    await act(async () => {
      fireEvent.click(screen.getByText("settings.twoFactor.disable"));
    });
    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "654321" } });
    await act(async () => {
      fireEvent.click(screen.getAllByText("settings.twoFactor.disable")[0]);
    });
    await waitFor(() => expect(screen.getByText("settings.twoFactor.enable")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/2fa",
      expect.objectContaining({ method: "DELETE", body: JSON.stringify({ code: "654321" }) }),
    );
  });
});
