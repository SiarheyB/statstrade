import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    timezone: "auto",
    setTimezone: vi.fn(),
    setLocale: vi.fn(),
    locale: "ru",
    t: (k: string) => k,
  }),
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import KeepAwakeButton from "@/components/KeepAwakeButton";
import { KEEP_AWAKE_KEY } from "@/lib/useWakeLock";

type Listener = () => void;

function fakeWakeLock() {
  const released: Listener[] = [];
  const sentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true;
      released.forEach((cb) => cb());
    }),
    addEventListener: (_: "release", cb: Listener) => released.push(cb),
    removeEventListener: vi.fn(),
  };
  const request = vi.fn(async () => sentinel);
  Object.defineProperty(navigator, "wakeLock", {
    value: { request },
    configurable: true,
    writable: true,
  });
  return { sentinel, request };
}

const mount = async () => {
  await act(async () => {
    render(<KeepAwakeButton />);
  });
};

describe("KeepAwakeButton", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    // @ts-expect-error — убираем подменённое свойство между тестами
    delete navigator.wakeLock;
  });

  it("не рисует кнопку там, где Screen Wake Lock недоступен", async () => {
    await mount();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("по умолчанию удерживает экран, как только страница открыта", async () => {
    const { request } = fakeWakeLock();
    await mount();
    expect(request).toHaveBeenCalledWith("screen");
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("клик снимает удержание и запоминает выбор", async () => {
    const { sentinel } = fakeWakeLock();
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(sentinel.release).toHaveBeenCalled();
    expect(localStorage.getItem(KEEP_AWAKE_KEY)).toBe("0");
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
  });

  it("выключенное удержание не запрашивает блокировку при открытии", async () => {
    localStorage.setItem(KEEP_AWAKE_KEY, "0");
    const { request } = fakeWakeLock();
    await mount();
    expect(request).not.toHaveBeenCalled();
  });

  it("отпускает блокировку, когда график закрывают", async () => {
    const { sentinel } = fakeWakeLock();
    let unmount = () => {};
    await act(async () => {
      unmount = render(<KeepAwakeButton />).unmount;
    });
    await act(async () => {
      unmount();
    });
    expect(sentinel.release).toHaveBeenCalled();
  });
});
