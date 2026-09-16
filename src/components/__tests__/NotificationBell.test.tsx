import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import "@testing-library/jest-dom";
import NotificationBell from "@/components/NotificationBell";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

const NOTIFICATION_WITH_URL = {
  id: "n1",
  kind: "level_alert",
  title: "BTCUSDT: цена у уровня 65000",
  body: "Сейчас 64950 — подходим снизу.",
  url: "/dashboard/recommendations",
  createdAt: new Date().toISOString(),
  readAt: null,
};

const NOTIFICATION_NO_URL = {
  id: "n2",
  kind: "econcal",
  title: "Через 15 мин: USD",
  body: "USD · FOMC Press Conference",
  url: null,
  createdAt: new Date().toISOString(),
  readAt: null,
};

function mockFetch(notifications: typeof NOTIFICATION_WITH_URL[]) {
  const markReadCalls: unknown[] = [];
  const fn = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/announcements") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ announcements: [] }) });
    }
    if (url === "/api/notifications" && (!init || init.method === undefined)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ notifications }) });
    }
    if (url === "/api/notifications" && init?.method === "POST") {
      markReadCalls.push(JSON.parse(init.body as string));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, updated: 1 }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, markReadCalls };
}

describe("NotificationBell", () => {
  beforeEach(() => {
    push.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("показывает счётчик непрочитанных и раскрывает список по клику", async () => {
    mockFetch([NOTIFICATION_WITH_URL, NOTIFICATION_NO_URL]);
    await act(async () => {
      render(<NotificationBell />);
    });
    expect(await screen.findByText("2")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "notifications.title" }));

    expect(screen.getByText(NOTIFICATION_WITH_URL.title)).toBeInTheDocument();
    expect(screen.getByText(NOTIFICATION_NO_URL.title)).toBeInTheDocument();
  });

  // Раньше строку можно было отметить прочитанной только кликом по всей
  // строке (заодно уводившим по ссылке) — без единого видимого признака, что
  // так вообще можно. Явная кнопка должна отмечать прочитанным, НЕ уводя со
  // страницы, даже если у строки есть свой url.
  it("кнопка «прочитано» отмечает уведомление, но не переходит по его ссылке", async () => {
    const { markReadCalls } = mockFetch([NOTIFICATION_WITH_URL]);
    await act(async () => {
      render(<NotificationBell />);
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "notifications.title" }));
    expect(screen.getByText(NOTIFICATION_WITH_URL.title)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "notifications.markRead" }));

    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(markReadCalls).toContainEqual({ id: NOTIFICATION_WITH_URL.id }));
    await waitFor(() => expect(screen.queryByText(NOTIFICATION_WITH_URL.title)).not.toBeInTheDocument());
  });

  it("клик по самой строке со ссылкой переходит по адресу и отмечает прочитанным", async () => {
    const { markReadCalls } = mockFetch([NOTIFICATION_WITH_URL]);
    await act(async () => {
      render(<NotificationBell />);
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "notifications.title" }));
    await user.click(screen.getByText(NOTIFICATION_WITH_URL.title));

    expect(push).toHaveBeenCalledWith(NOTIFICATION_WITH_URL.url);
    await waitFor(() => expect(markReadCalls).toContainEqual({ id: NOTIFICATION_WITH_URL.id }));
  });

  it("«Прочитать всё» отмечает все непрочитанные и счётчик обнуляется", async () => {
    const { markReadCalls } = mockFetch([NOTIFICATION_WITH_URL, NOTIFICATION_NO_URL]);
    await act(async () => {
      render(<NotificationBell />);
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "notifications.title" }));
    await user.click(screen.getByRole("button", { name: "notifications.markAllRead" }));

    await waitFor(() => expect(markReadCalls).toHaveLength(2));
    expect(markReadCalls).toContainEqual({ id: NOTIFICATION_WITH_URL.id });
    expect(markReadCalls).toContainEqual({ id: NOTIFICATION_NO_URL.id });
    await waitFor(() => expect(screen.getByText("notifications.empty")).toBeInTheDocument());
  });
});
