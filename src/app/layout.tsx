import type { Metadata } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import { getLocale, getTimezone } from "@/lib/i18n/server";
import { getTheme } from "@/lib/theme.server";
import { pageMetadata, siteJsonLd, SEO_PAGES } from "@/lib/seo";
import { I18nProvider } from "@/lib/i18n/provider";
import { ThemeProvider } from "@/components/ThemeProvider";
import TrafficBeacon from "@/components/TrafficBeacon";
import "./globals.css";

// Manrope — premium modern grotesk with full Cyrillic support (the UI is
// bilingual EN/RU), for a more "expensive" fintech feel than the generic Inter.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// Метаданные корня: заголовок, описание, canonical и Open Graph главной
// страницы (см. lib/seo.ts). Вложенные публичные страницы переопределяют их
// своими — иначе /news и /calendar выглядят в выдаче дублями главной.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return pageMetadata(SEO_PAGES.home, locale);
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const timezone = await getTimezone();
  const theme = await getTheme();
  const jsonLd = await siteJsonLd(locale);

  return (
    <html
      lang={locale}
      data-theme={theme}
      className={`${manrope.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Машиночитаемое описание сайта для поисковиков (schema.org). */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
        <ThemeProvider theme={theme}>
          <I18nProvider locale={locale} timezone={timezone}>{children}</I18nProvider>
        </ThemeProvider>
        {/* Счётчик посещаемости, см. components/TrafficBeacon.tsx */}
        <TrafficBeacon />
      </body>
    </html>
  );
}
