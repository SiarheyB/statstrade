import { describe, it, expect, vi } from "vitest";
import { getLocale, getTimezone } from "@/lib/i18n/server";
import RootLayout, { generateMetadata } from "../layout";
import { SEO_PAGES } from "@/lib/seo";

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

// siteUrl() читает заголовки запроса (для canonical и Open Graph) — вне
// запроса их нет, поэтому подставляем прод-хост.
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => (k.toLowerCase() === "host" ? "tradingstat.ru" : null) }),
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
    expect(meta.title).toBe(SEO_PAGES.home.title.ru);
  });

  it("generateMetadata returns English title for en locale", async () => {
    (getLocale as any).mockResolvedValue("en");
    const meta = await generateMetadata();
    expect(meta.title).toBe(SEO_PAGES.home.title.en);
  });

  // Без canonical и Open Graph страница выглядит в выдаче безымянной, а ссылка
  // в мессенджере разворачивается голой.
  it("generateMetadata carries an absolute canonical and Open Graph over https", async () => {
    (getLocale as any).mockResolvedValue("ru");
    const meta = await generateMetadata();
    expect(meta.alternates?.canonical).toBe("https://tradingstat.ru");
    expect(meta.openGraph?.url).toBe("https://tradingstat.ru");
    expect(meta.openGraph?.title).toBe(SEO_PAGES.home.title.ru);
  });
});
