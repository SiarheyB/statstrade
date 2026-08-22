import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import GeneralSettingsPage from "../page";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    locale: "ru",
    timezone: "auto",
    setLocale: vi.fn(),
    setTimezone: vi.fn(),
  }),
}));

vi.mock("@/components/LocaleMenu", () => ({ default: () => <div data-testid="locale-menu" /> }));
vi.mock("@/components/TimezoneMenu", () => ({ default: () => <div data-testid="timezone-menu" /> }));
vi.mock("@/components/TwoFactorSettings", () => ({ default: () => <div data-testid="two-factor" /> }));
vi.mock("@/components/ChangePassword", () => ({ default: () => <div data-testid="change-password" /> }));
vi.mock("@/components/GoogleLinkSettings", () => ({ default: () => <div data-testid="google-link" /> }));
vi.mock("@/components/CloudStorageSettings", () => ({ default: () => <div data-testid="cloud-storage" /> }));
vi.mock("@/components/YandexDiskSettings", () => ({ default: () => <div data-testid="yandex-disk" /> }));
vi.mock("@/components/DeleteAccount", () => ({ default: () => <div data-testid="delete-account" /> }));

describe("GeneralSettingsPage", () => {
  it("renders heading and all settings sections", () => {
    render(<GeneralSettingsPage />);
    expect(screen.getByText("nav.general")).toBeInTheDocument();
    expect(screen.getByTestId("locale-menu")).toBeInTheDocument();
    expect(screen.getByTestId("timezone-menu")).toBeInTheDocument();
    expect(screen.getByTestId("two-factor")).toBeInTheDocument();
    expect(screen.getByTestId("change-password")).toBeInTheDocument();
    expect(screen.getByTestId("google-link")).toBeInTheDocument();
    expect(screen.getByTestId("cloud-storage")).toBeInTheDocument();
    expect(screen.getByTestId("yandex-disk")).toBeInTheDocument();
    expect(screen.getByTestId("delete-account")).toBeInTheDocument();
    // Режим ментора переехал в свой раздел настроек (/dashboard/settings/mentor).
    expect(screen.queryByTestId("mentor-share")).not.toBeInTheDocument();
  });
});
