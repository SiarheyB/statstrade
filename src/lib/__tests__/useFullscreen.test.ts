import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFullscreen } from "@/lib/useFullscreen";

type FsDoc = Document & {
  fullscreenElement: Element | null;
  exitFullscreen?: () => Promise<void>;
};

/** Привязывает ref хука к настоящему элементу — без него toggle() ничего не делает. */
function attach(ref: React.RefObject<HTMLDivElement | null>): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  ref.current = el;
  return el;
}

function setFullscreenElement(el: Element | null) {
  Object.defineProperty(document, "fullscreenElement", { value: el, configurable: true });
}

describe("useFullscreen", () => {
  beforeEach(() => {
    setFullscreenElement(null);
    // notifyResize ждёт два кадра — в тестах выполняем колбэк сразу.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    document.body.style.overflow = "";
  });

  it("разворачивает нативно, когда браузер это умеет", async () => {
    const { result } = renderHook(() => useFullscreen<HTMLDivElement>());
    const el = attach(result.current.ref);
    const request = vi.fn().mockResolvedValue(undefined);
    el.requestFullscreen = request;

    await act(async () => result.current.toggle());

    expect(request).toHaveBeenCalledTimes(1);
    // Флаг ставит не toggle, а событие от браузера — иначе кнопка соврала бы
    // при отказе развернуть.
    expect(result.current.active).toBe(false);

    setFullscreenElement(el);
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.active).toBe(true);
  });

  it("выходит из нативного полноэкранного режима по второму нажатию", async () => {
    const { result } = renderHook(() => useFullscreen<HTMLDivElement>());
    const el = attach(result.current.ref);
    el.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn().mockResolvedValue(undefined);
    (document as FsDoc).exitFullscreen = exit;

    setFullscreenElement(el);
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    await act(async () => result.current.toggle());

    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("снимает флаг, когда в полноэкранный режим ушёл чужой элемент", () => {
    const { result } = renderHook(() => useFullscreen<HTMLDivElement>());
    const el = attach(result.current.ref);
    setFullscreenElement(el);
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.active).toBe(true);

    setFullscreenElement(document.createElement("section"));
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.active).toBe(false);
  });

  it("разворачивает оверлеем там, где Fullscreen API нет", async () => {
    const resize = vi.fn();
    window.addEventListener("resize", resize);
    const { result } = renderHook(() => useFullscreen<HTMLDivElement>());
    const el = attach(result.current.ref);
    // @ts-expect-error — эмулируем браузер без Fullscreen API (iOS Safari).
    el.requestFullscreen = undefined;

    await act(async () => result.current.toggle());

    expect(result.current.active).toBe(true);
    // Канвасы пересчитывают размеры только по resize — без него график остался
    // бы прежнего размера внутри развёрнутого блока.
    expect(resize).toHaveBeenCalled();
    expect(document.body.style.overflow).toBe("hidden");
    window.removeEventListener("resize", resize);
  });

  it("разворачивает оверлеем, если браузер отказал в запросе", async () => {
    const { result } = renderHook(() => useFullscreen<HTMLDivElement>());
    const el = attach(result.current.ref);
    el.requestFullscreen = vi.fn().mockRejectedValue(new Error("denied"));

    await act(async () => result.current.toggle());

    expect(result.current.active).toBe(true);
  });

  it("закрывает оверлей по Esc и возвращает прокрутку странице", async () => {
    const { result } = renderHook(() => useFullscreen<HTMLDivElement>());
    const el = attach(result.current.ref);
    // @ts-expect-error — эмулируем браузер без Fullscreen API.
    el.requestFullscreen = undefined;
    await act(async () => result.current.toggle());
    expect(result.current.active).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(result.current.active).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  it("сворачивает оверлей повторным нажатием кнопки", async () => {
    const { result } = renderHook(() => useFullscreen<HTMLDivElement>());
    const el = attach(result.current.ref);
    // @ts-expect-error — эмулируем браузер без Fullscreen API.
    el.requestFullscreen = undefined;
    await act(async () => result.current.toggle());
    await act(async () => result.current.toggle());

    expect(result.current.active).toBe(false);
  });

  it("ничего не делает, пока ref ни к чему не привязан", async () => {
    const { result } = renderHook(() => useFullscreen<HTMLDivElement>());
    await act(async () => result.current.toggle());
    expect(result.current.active).toBe(false);
  });
});
