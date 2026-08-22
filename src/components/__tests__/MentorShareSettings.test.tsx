import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import MentorShareSettings from "@/components/MentorShareSettings";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string, vars?: Record<string, string | number>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    locale: "ru",
    timezone: "auto",
  }),
}));

const ACCOUNTS = [
  { id: "a1", label: "Основной", exchange: "bybit" },
  { id: "a2", label: "Форекс", exchange: "mt5" },
];

function mockFetch(
  featureEnabled: boolean,
  links: Array<Record<string, unknown>> = [],
  accounts: Array<Record<string, unknown>> = ACCOUNTS,
) {
  const fn = vi.fn((url: string) => {
    if (url.includes("/api/features")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ value: { enabled: featureEnabled, maxLinksPerUser: 5 } }),
      });
    }
    if (url.includes("/api/accounts")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(accounts) });
    }
    if (url.includes("/api/share-links")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ links }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("MentorShareSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("confirm", vi.fn(() => true));
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders nothing when the feature is disabled", async () => {
    mockFetch(false);
    const { container } = await act(async () => render(<MentorShareSettings />));
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("renders the create form when the feature is enabled", async () => {
    mockFetch(true);
    await act(async () => {
      render(<MentorShareSettings />);
    });
    expect(await screen.findByText("mentor.title")).toBeInTheDocument();
    expect(screen.getByText("mentor.empty")).toBeInTheDocument();
  });

  it("creates a share link", async () => {
    const fetchMock = mockFetch(true);
    await act(async () => {
      render(<MentorShareSettings />);
    });
    await screen.findByText("mentor.title");

    // After creation, load() is called again returning a link
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/api/features")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ value: { enabled: true, maxLinksPerUser: 5 } }),
        });
      }
      if (url.includes("/api/accounts")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ACCOUNTS) });
      }
      if (url.includes("/api/share-links") && !url.includes("?")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ links: [{ id: "l1", token: "tok1", label: "My mentor", createdAt: "", lastViewedAt: null, accountId: null, expiresAt: null }] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    fireEvent.change(screen.getByPlaceholderText("mentor.labelPlaceholder"), { target: { value: "My mentor" } });
    await act(async () => {
      fireEvent.click(screen.getByText("mentor.create"));
    });

    expect(await screen.findByText("My mentor")).toBeInTheDocument();
  });

  it("copies the link to clipboard", async () => {
    mockFetch(true, [{ id: "l1", token: "tok1", label: "Mentor A", createdAt: "", lastViewedAt: null, accountId: null, expiresAt: null }]);
    await act(async () => {
      render(<MentorShareSettings />);
    });
    const copyBtn = await screen.findByTitle("mentor.copy");
    fireEvent.click(copyBtn);
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/share/tok1")),
    );
  });

  it("revokes a link after confirmation", async () => {
    const fetchMock = mockFetch(true, [{ id: "l1", token: "tok1", label: "Mentor A", createdAt: "", lastViewedAt: null, accountId: null, expiresAt: null }]);
    await act(async () => {
      render(<MentorShareSettings />);
    });
    const revokeBtn = await screen.findByTitle("mentor.revoke");
    await act(async () => {
      fireEvent.click(revokeBtn);
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/share-links?id=l1"), expect.objectContaining({ method: "DELETE" }));
  });

  it("в списке счетов первым идёт «все биржи», дальше подключённые", async () => {
    mockFetch(true);
    await act(async () => {
      render(<MentorShareSettings />);
    });
    await screen.findByText("mentor.title");

    // Первый выпадающий список — счета, второй — период.
    const accountSelect = screen.getAllByRole("combobox")[0];
    const options = [...accountSelect.querySelectorAll("option")];
    expect(options.map((o) => o.textContent)).toEqual([
      "mentor.allAccounts",
      "Основной · BYBIT",
      "Форекс · MT5",
    ]);
    // По умолчанию — все биржи: ссылка без выбора счёта ведёт себя как раньше.
    expect((accountSelect as HTMLSelectElement).value).toBe("");
  });

  it("создаёт ссылку на выбранный счёт", async () => {
    const fetchMock = mockFetch(true);
    await act(async () => {
      render(<MentorShareSettings />);
    });
    await screen.findByText("mentor.title");

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "a2" } });
    await act(async () => {
      fireEvent.click(screen.getByText("mentor.create"));
    });

    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(post![1].body as string)).toEqual({ accountId: "a2" });
  });

  it("показывает у ссылки, чей это счёт, и помечает удалённый", async () => {
    mockFetch(true, [
      { id: "l1", token: "t1", label: "На bybit", createdAt: "", lastViewedAt: null, accountId: "a1", periodFrom: null, periodTo: null, expiresAt: null },
      {
        id: "l2", token: "t2", label: "На всё", createdAt: "", lastViewedAt: null, accountId: null,
        periodFrom: "2026-06-01T00:00:00.000Z", periodTo: "2026-07-01T00:00:00.000Z",
        expiresAt: null,
      },
      { id: "l3", token: "t3", label: "Осиротевшая", createdAt: "", lastViewedAt: null, accountId: "gone", periodFrom: null, periodTo: null, expiresAt: null },
    ]);
    await act(async () => {
      render(<MentorShareSettings />);
    });

    // Тот же текст есть и пунктом выпадающего списка — берём все совпадения.
    // Подпись ссылки: счёт и период вместе.
    expect(await screen.findByText(/Основной · BYBIT · mentor\.periodAll/)).toBeInTheDocument();
    expect(screen.getByText(/mentor\.accountGone/)).toBeInTheDocument();
    // Конец хранится как начало следующих суток — в подписи показываем 30 июня.
    expect(screen.getByText(/mentor\.allAccounts · 6\/1\/2026 — 6\/30\/2026/)).toBeInTheDocument();
  });

  it("отправляет выбранные даты периода", async () => {
    const fetchMock = mockFetch(true);
    await act(async () => {
      render(<MentorShareSettings />);
    });
    await screen.findByText("mentor.title");

    const from = screen.getByLabelText("mentor.periodFrom");
    const to = screen.getByLabelText("mentor.periodTo");
    fireEvent.change(from, { target: { value: "2026-06-01" } });
    fireEvent.change(to, { target: { value: "2026-06-30" } });
    // Календари ограничивают друг друга, чтобы нельзя было выбрать конец раньше начала.
    expect(to).toHaveAttribute("min", "2026-06-01");
    expect(from).toHaveAttribute("max", "2026-06-30");

    await act(async () => {
      fireEvent.click(screen.getByText("mentor.create"));
    });

    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(post![1].body as string)).toEqual({
      periodFrom: "2026-06-01",
      periodTo: "2026-06-30",
    });
  });

  it("сбрасывает обе даты одной кнопкой", async () => {
    mockFetch(true);
    await act(async () => {
      render(<MentorShareSettings />);
    });
    await screen.findByText("mentor.title");

    fireEvent.change(screen.getByLabelText("mentor.periodFrom"), { target: { value: "2026-06-01" } });
    fireEvent.click(screen.getByTitle("mentor.periodClear"));
    expect(screen.getByLabelText("mentor.periodFrom")).toHaveValue("");
  });

  it("по умолчанию ссылка бессрочная и срок в запрос не уходит", async () => {
    const fetchMock = mockFetch(true);
    await act(async () => {
      render(<MentorShareSettings />);
    });
    await screen.findByText("mentor.title");

    await act(async () => {
      fireEvent.click(screen.getByText("mentor.create"));
    });

    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(post![1].body as string)).toEqual({});
  });

  it("отправляет выбранный срок жизни", async () => {
    const fetchMock = mockFetch(true);
    await act(async () => {
      render(<MentorShareSettings />);
    });
    await screen.findByText("mentor.title");

    // Переключаемся на дни и ставим 102 — срок задаётся любым числом, не пресетом.
    fireEvent.click(screen.getByText("mentor.ttl.days"));
    fireEvent.change(screen.getByLabelText("mentor.ttl.days"), { target: { value: "102" } });
    await act(async () => {
      fireEvent.click(screen.getByText("mentor.create"));
    });

    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(post![1].body as string)).toEqual({ ttlUnit: "days", ttlValue: 102 });
  });

  it("показывает у ссылки, когда она истекает или уже истекла", async () => {
    mockFetch(true, [
      {
        id: "l1", token: "t1", label: "Живая", createdAt: "", lastViewedAt: null,
        accountId: null, periodFrom: null, periodTo: null,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      {
        id: "l2", token: "t2", label: "Просроченная", createdAt: "", lastViewedAt: null,
        accountId: null, periodFrom: null, periodTo: null,
        expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    ]);
    await act(async () => {
      render(<MentorShareSettings />);
    });

    expect(await screen.findByText(/mentor\.expiresAt/)).toBeInTheDocument();
    expect(screen.getByText(/mentor\.expiredAt/)).toBeInTheDocument();
  });
});
