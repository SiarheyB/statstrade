import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockSetTimezone = vi.fn();
vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    timezone: "auto",
    setTimezone: mockSetTimezone,
    setLocale: vi.fn(),
    locale: "en",
    t: (k: string) => k,
  }),
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import TimezoneMenu from "@/components/TimezoneMenu";

describe("TimezoneMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the auto label for the default timezone", () => {
    render(<TimezoneMenu />);
    expect(screen.getByText("settings.timezoneAuto")).toBeInTheDocument();
  });

  it("opens a listbox of timezones", () => {
    render(<TimezoneMenu />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("calls setTimezone when an option is picked", () => {
    render(<TimezoneMenu />);
    fireEvent.click(screen.getByRole("button"));
    const option = screen.getByRole("option", { name: /UTC\+3/i });
    fireEvent.click(option);
    expect(mockSetTimezone).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    render(<TimezoneMenu />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
