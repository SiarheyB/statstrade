import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import PresenceBeacon from "../PresenceBeacon";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("PresenceBeacon", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("пингует сразу и раз в минуту, пока человек активен", () => {
    render(<PresenceBeacon />);
    expect(fetchMock).toHaveBeenCalledWith("/api/presence", expect.objectContaining({ method: "POST" }));

    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("молчит на скрытой вкладке", () => {
    render(<PresenceBeacon />);
    fetchMock.mockClear();
    setVisibility("hidden");
    vi.advanceTimersByTime(5 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("молчит, если человек ничего не делал — открытая вкладка это не онлайн", () => {
    render(<PresenceBeacon />);
    fetchMock.mockClear();
    // Никаких событий активности: через IDLE_MS пинги прекращаются.
    vi.advanceTimersByTime(10 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(5); // только первые 5 минут
  });

  it("возврат на вкладку сразу возобновляет пинг", () => {
    render(<PresenceBeacon />);
    setVisibility("hidden");
    vi.advanceTimersByTime(30 * 60_000);
    fetchMock.mockClear();
    setVisibility("visible");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
