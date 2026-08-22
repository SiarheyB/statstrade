import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MentorSettingsPage from "../page";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "ru", timezone: "auto" }),
}));
vi.mock("@/components/MentorShareSettings", () => ({
  default: () => <div data-testid="mentor-share" />,
}));

describe("MentorSettingsPage", () => {
  it("показывает раздел с заголовком и самим блоком ссылок", () => {
    render(<MentorSettingsPage />);
    expect(screen.getByRole("heading", { name: "mentor.title" })).toBeInTheDocument();
    expect(screen.getByTestId("mentor-share")).toBeInTheDocument();
  });
});
