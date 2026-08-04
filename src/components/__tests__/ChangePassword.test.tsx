import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import ChangePassword from "@/components/ChangePassword";

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

async function openForm(hasPassword = true) {
  mockFetchSequence([{ ok: true, json: { hasPassword } }]);
  await act(async () => {
    render(<ChangePassword />);
  });
  const btn = await screen.findByRole("button", {
    name: hasPassword ? "settings.password" : "settings.password.set",
  });
  fireEvent.click(btn);
}

describe("ChangePassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'set password' title when user has no password", async () => {
    mockFetchSequence([{ ok: true, json: { hasPassword: false } }]);
    await act(async () => {
      render(<ChangePassword />);
    });
    expect(await screen.findByRole("button", { name: "settings.password.set" })).toBeInTheDocument();
  });

  it("does not show current-password field when user has none", async () => {
    await openForm(false);
    expect(screen.queryByLabelText(/current/i)).not.toBeInTheDocument();
    expect(screen.getByText("settings.password.new")).toBeInTheDocument();
  });

  it("validates password mismatch", async () => {
    await openForm(true);
    fireEvent.change(screen.getByPlaceholderText("auth.passwordHintReg"), { target: { value: "Abc123!@" } });
    const confirmInputs = screen.getAllByDisplayValue("");
    const confirmInput = confirmInputs[confirmInputs.length - 1];
    fireEvent.change(confirmInput, { target: { value: "Different1!" } });
    fireEvent.click(screen.getByText("common.save"));
    expect(await screen.findByText("settings.password.mismatch")).toBeInTheDocument();
  });

  it("validates too-short/invalid password", async () => {
    await openForm(true);
    fireEvent.change(screen.getByPlaceholderText("auth.passwordHintReg"), { target: { value: "abc" } });
    fireEvent.click(screen.getByText("common.save"));
    expect(await screen.findByText("settings.password.tooShort")).toBeInTheDocument();
  });

  it("submits successfully and shows confirmation", async () => {
    mockFetchSequence([{ ok: true, json: { hasPassword: true } }]);
    await act(async () => {
      render(<ChangePassword />);
    });
    fireEvent.click(await screen.findByRole("button", { name: "settings.password" }));

    // Now stub the PUT call
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));

    const inputs = screen.getAllByDisplayValue("");
    // current, new, confirm order
    fireEvent.change(inputs[0], { target: { value: "oldpass" } });
    fireEvent.change(inputs[1], { target: { value: "NewPass1!" } });
    fireEvent.change(inputs[2], { target: { value: "NewPass1!" } });

    await act(async () => {
      fireEvent.click(screen.getByText("common.save"));
    });

    await waitFor(() => expect(screen.getByText("settings.password.changed")).toBeInTheDocument());
  });

  it("shows server error on failed save", async () => {
    mockFetchSequence([{ ok: true, json: { hasPassword: true } }]);
    await act(async () => {
      render(<ChangePassword />);
    });
    fireEvent.click(await screen.findByRole("button", { name: "settings.password" }));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "Wrong current password" }) }),
    );

    const inputs = screen.getAllByDisplayValue("");
    fireEvent.change(inputs[0], { target: { value: "oldpass" } });
    fireEvent.change(inputs[1], { target: { value: "NewPass1!" } });
    fireEvent.change(inputs[2], { target: { value: "NewPass1!" } });

    await act(async () => {
      fireEvent.click(screen.getByText("common.save"));
    });

    expect(await screen.findByText("Wrong current password")).toBeInTheDocument();
  });
});
