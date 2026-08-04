import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import AuthForm from "@/components/AuthForm";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "ru", timezone: "auto" }),
}));

vi.mock("@/components/GoogleSignInButton", () => ({
  default: () => <div data-testid="google-btn" />,
}));

vi.mock("@/components/TurnstileWidget", () => ({
  default: () => <div data-testid="turnstile" />,
}));

describe("AuthForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    );
  });

  it("renders login fields", () => {
    render(<AuthForm mode="login" />);
    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
    expect(screen.getByText("auth.signIn")).toBeInTheDocument();
    expect(screen.queryByText("auth.name")).not.toBeInTheDocument();
  });

  it("renders register fields including name and password strength", () => {
    render(<AuthForm mode="register" />);
    expect(screen.getByText("auth.name")).toBeInTheDocument();
    expect(screen.getByText("auth.signUp")).toBeInTheDocument();
  });

  it("submits login and navigates on success", async () => {
    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "secret" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("auth.signIn"));
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "a@b.com", password: "secret" }),
      }),
    );
  });

  it("shows server error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "Bad creds" }) }),
    );
    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "secret" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("auth.signIn"));
    });
    expect(await screen.findByText("Bad creds")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("switches to 2FA step when server requires it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ twoFactorRequired: true }) }),
    );
    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "secret" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("auth.signIn"));
    });
    expect(await screen.findByText("auth.twoFactor.title")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("submits 2FA code and navigates on success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ twoFactorRequired: true }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "secret" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("auth.signIn"));
    });
    await screen.findByText("auth.twoFactor.title");
    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
    await act(async () => {
      fireEvent.click(screen.getByText("auth.twoFactor.verify"));
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/auth/2fa/login",
      expect.objectContaining({ body: JSON.stringify({ code: "123456" }) }),
    );
  });

  it("network error shows generic message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "secret" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("auth.signIn"));
    });
    expect(await screen.findByText("auth.networkError")).toBeInTheDocument();
  });

  it("disables register submit until password valid", () => {
    render(<AuthForm mode="register" />);
    const submit = screen.getByText("auth.signUp");
    expect(submit).toBeDisabled();
  });
});
