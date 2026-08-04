import { describe, it, expect, vi } from "vitest";
import { getLocale, getTimezone } from "@/lib/i18n/server";
import RootLayout, { generateMetadata } from "../layout";

// RootLayout renders <html>/<body>, which RTL cannot mount inside a container
// (jsdom's document already has its own <html>/<body>). Instead of calling
// render(), we call the async server component directly and assert on the
// returned React element tree structurally.

vi.mock("@/lib/i18n/server", () => ({
  getLocale: vi.fn(),
  getTimezone: vi.fn(),
}));

vi.mock("@/lib/i18n/provider", () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// next/font/google requires network access to fetch real font files at build
// time — under vitest it just needs to return a stable class/variable shape.
vi.mock("next/font/google", () => ({
  Manrope: () => ({ variable: "--font-manrope", className: "font-manrope" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono", className: "font-geist-mono" }),
}));

describe("RootLayout", () => {
  it("renders an <html> element with the resolved locale and a <body> wrapping children", async () => {
    (getLocale as any).mockResolvedValue("ru");
    (getTimezone as any).mockResolvedValue("Europe/Moscow");

    const element = (await RootLayout({ children: "hello" })) as any;

    expect(element.type).toBe("html");
    expect(element.props.lang).toBe("ru");

    const body = element.props.children;
    expect(body.type).toBe("body");
  });

  it("generateMetadata returns Russian title for ru locale", async () => {
    (getLocale as any).mockResolvedValue("ru");
    const meta = await generateMetadata();
    expect(meta.title).toBe("TradeStats — статистика трейдера");
  });

  it("generateMetadata returns English title for en locale", async () => {
    (getLocale as any).mockResolvedValue("en");
    const meta = await generateMetadata();
    expect(meta.title).toBe("TradeStats — trader statistics");
  });
});
