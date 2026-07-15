import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockSetLocale = vi.fn();
vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    locale: "en",
    setLocale: mockSetLocale,
    setTimezone: vi.fn(),
    timezone: "auto",
    t: (k: string) => k,
  }),
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import LocaleMenu from "@/components/LocaleMenu";

describe("LocaleMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the current locale short code", () => {
    render(<LocaleMenu />);
    expect(screen.getByText("EN")).toBeInTheDocument();
  });

  it("opens and lists available locales", () => {
    render(<LocaleMenu />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("English")).toBeInTheDocument();
    expect(screen.getByText("Русский")).toBeInTheDocument();
  });

  it("calls setLocale when a locale is picked", () => {
    render(<LocaleMenu />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Русский"));
    expect(mockSetLocale).toHaveBeenCalledWith("ru");
  });
});
