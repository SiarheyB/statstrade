import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import GoogleLinkSettings from "@/components/GoogleLinkSettings";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "ru", timezone: "auto" }),
}));

vi.mock("@/components/GoogleSignInButton", () => ({
  default: ({ onCredential }: { onCredential: (c: string) => void }) => (
    <button onClick={() => onCredential("cred-token")}>mock-google-signin</button>
  ),
}));

function mockFetchSequence(responses: Array<{ ok: boolean; json: unknown }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockImplementationOnce(() => Promise.resolve({ ok: r.ok, json: () => Promise.resolve(r.json) }));
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("GoogleLinkSettings", () => {
  const prevClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "test-client-id";
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = prevClientId;
  });

  it("renders nothing when Google is not configured", async () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "";
    mockFetchSequence([{ ok: true, json: { linked: false, hasPassword: true } }]);
    const { container } = render(<GoogleLinkSettings />);
    expect(container.firstChild).toBeNull();
  });

  it("shows sign-in button when not linked", async () => {
    mockFetchSequence([{ ok: true, json: { linked: false, hasPassword: true } }]);
    await act(async () => {
      render(<GoogleLinkSettings />);
    });
    expect(await screen.findByText("mock-google-signin")).toBeInTheDocument();
  });

  it("shows linked badge and unlink button when linked with a password", async () => {
    mockFetchSequence([{ ok: true, json: { linked: true, hasPassword: true } }]);
    await act(async () => {
      render(<GoogleLinkSettings />);
    });
    expect(await screen.findByText("settings.google.linked")).toBeInTheDocument();
    expect(screen.getByText("settings.google.unlink")).toBeInTheDocument();
  });

  it("hides unlink button and shows a hint when linked without a password", async () => {
    mockFetchSequence([{ ok: true, json: { linked: true, hasPassword: false } }]);
    await act(async () => {
      render(<GoogleLinkSettings />);
    });
    expect(await screen.findByText("settings.google.needPassword")).toBeInTheDocument();
    expect(screen.queryByText("settings.google.unlink")).not.toBeInTheDocument();
  });

  it("links the account when the sign-in button provides a credential", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { linked: false, hasPassword: true } },
      { ok: true, json: {} },
    ]);
    await act(async () => {
      render(<GoogleLinkSettings />);
    });
    await screen.findByText("mock-google-signin");
    await act(async () => {
      fireEvent.click(screen.getByText("mock-google-signin"));
    });
    await waitFor(() => expect(screen.getByText("settings.google.linked")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/google/link",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ credential: "cred-token" }) }),
    );
  });

  it("unlinks the account", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { linked: true, hasPassword: true } },
      { ok: true, json: {} },
    ]);
    await act(async () => {
      render(<GoogleLinkSettings />);
    });
    await screen.findByText("settings.google.unlink");
    await act(async () => {
      fireEvent.click(screen.getByText("settings.google.unlink"));
    });
    await waitFor(() => expect(screen.getByText("mock-google-signin")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/auth/google/link", expect.objectContaining({ method: "DELETE" }));
  });

  it("shows error message when link fails", async () => {
    mockFetchSequence([
      { ok: true, json: { linked: false, hasPassword: true } },
      { ok: false, json: { error: "Already linked to another account" } },
    ]);
    await act(async () => {
      render(<GoogleLinkSettings />);
    });
    await screen.findByText("mock-google-signin");
    await act(async () => {
      fireEvent.click(screen.getByText("mock-google-signin"));
    });
    expect(await screen.findByText("Already linked to another account")).toBeInTheDocument();
  });
});
