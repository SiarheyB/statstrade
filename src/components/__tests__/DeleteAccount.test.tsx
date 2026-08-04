import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import DeleteAccount from "@/components/DeleteAccount";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "ru", timezone: "auto" }),
}));

function mockFetchSequence(responses: Array<{ ok: boolean; json: unknown }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockImplementationOnce(() => Promise.resolve({ ok: r.ok, json: () => Promise.resolve(r.json) }));
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("DeleteAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the delete trigger button and gates the warning behind a click", async () => {
    mockFetchSequence([{ ok: true, json: { hasPassword: true } }]);
    await act(async () => {
      render(<DeleteAccount />);
    });
    expect(screen.queryByText("settings.deleteAccount.warning")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "settings.deleteAccount" }));
    expect(screen.getByText("settings.deleteAccount.warning")).toBeInTheDocument();
  });

  it("requires a password before enabling the confirm button when user has one", async () => {
    mockFetchSequence([{ ok: true, json: { hasPassword: true } }]);
    await act(async () => {
      render(<DeleteAccount />);
    });
    fireEvent.click(screen.getByRole("button", { name: "settings.deleteAccount" }));
    const confirmBtn = screen.getByRole("button", { name: "settings.deleteAccount.confirm" });
    expect(confirmBtn).toBeDisabled();
    const input = document.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "mypassword" } });
    expect(confirmBtn).not.toBeDisabled();
  });

  it("calls delete API with password and navigates to /login on success", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: { hasPassword: true } },
      { ok: true, json: {} },
    ]);
    await act(async () => {
      render(<DeleteAccount />);
    });
    fireEvent.click(screen.getByRole("button", { name: "settings.deleteAccount" }));
    const input = document.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "mypassword" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "settings.deleteAccount.confirm" }));
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/account/delete",
      expect.objectContaining({ method: "DELETE", body: JSON.stringify({ password: "mypassword" }) }),
    );
  });

  it("shows server error on failure", async () => {
    mockFetchSequence([
      { ok: true, json: { hasPassword: true } },
      { ok: false, json: { error: "Wrong password" } },
    ]);
    await act(async () => {
      render(<DeleteAccount />);
    });
    fireEvent.click(screen.getByRole("button", { name: "settings.deleteAccount" }));
    const input = document.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "wrong" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "settings.deleteAccount.confirm" }));
    });
    expect(await screen.findByText("Wrong password")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("skips password field when the user has no password", async () => {
    mockFetchSequence([{ ok: true, json: { hasPassword: false } }]);
    await act(async () => {
      render(<DeleteAccount />);
    });
    fireEvent.click(screen.getByRole("button", { name: "settings.deleteAccount" }));
    expect(document.querySelector("input")).toBeNull();
    expect(screen.getByRole("button", { name: "settings.deleteAccount.confirm" })).not.toBeDisabled();
  });
});
