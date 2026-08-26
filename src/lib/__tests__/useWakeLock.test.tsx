import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useWakeLock } from "@/lib/useWakeLock";

function Chart() {
  useWakeLock();
  return <canvas />;
}

type Listener = () => void;

function fakeWakeLock() {
  const onRelease: Listener[] = [];
  const sentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true;
      onRelease.forEach((cb) => cb());
    }),
    addEventListener: (_: "release", cb: Listener) => onRelease.push(cb),
  };
  const request = vi.fn(async () => sentinel);
  Object.defineProperty(navigator, "wakeLock", {
    value: { request },
    configurable: true,
    writable: true,
  });
  return { sentinel, request, dropBySystem: () => onRelease.forEach((cb) => cb()) };
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

const mount = async () => {
  let unmount = () => {};
  await act(async () => {
    unmount = render(<Chart />).unmount;
  });
  return unmount;
};

describe("useWakeLock", () => {
  beforeEach(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  afterEach(() => {
    // @ts-expect-error — убираем подменённое свойство между тестами
    delete navigator.wakeLock;
  });

  it("держит экран, как только открыт график — без всяких тумблеров", async () => {
    const { request } = fakeWakeLock();
    await mount();
    expect(request).toHaveBeenCalledWith("screen");
  });

  it("отпускает блокировку, когда со страницы графика уходят", async () => {
    const { sentinel } = fakeWakeLock();
    const unmount = await mount();
    await act(async () => {
      unmount();
    });
    expect(sentinel.release).toHaveBeenCalled();
  });

  it("не просит блокировку у скрытой вкладки и берёт её при возвращении", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const { request } = fakeWakeLock();
    await mount();
    expect(request).not.toHaveBeenCalled();

    await act(async () => {
      setVisibility("visible");
    });
    expect(request).toHaveBeenCalledWith("screen");
  });

  it("возвращает блокировку, которую отобрала система", async () => {
    const { request, dropBySystem } = fakeWakeLock();
    await mount();
    expect(request).toHaveBeenCalledTimes(1);

    // Система сняла удержание (свернули окно), потом вкладку открыли снова.
    await act(async () => {
      dropBySystem();
      setVisibility("visible");
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("молчит там, где Screen Wake Lock недоступен", async () => {
    // navigator.wakeLock не определён — хук не должен ничего ломать.
    const unmount = await mount();
    await act(async () => {
      unmount();
    });
    expect(true).toBe(true);
  });
});
