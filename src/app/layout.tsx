import type { Metadata } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { THEME_COOKIE, DEFAULT_THEME, isThemeId } from "@/lib/themes";
import { getLocale } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/provider";
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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return locale === "ru"
    ? {
        title: "TradeStats — статистика трейдера",
        description:
          "Аналитика торговых результатов: подключите Binance, Bybit и OKX по API и получите полную статистику по сделкам.",
      }
    : {
        title: "TradeStats — trader statistics",
        description:
          "Trading performance analytics: connect Binance, Bybit and OKX via API and get full trade statistics.",
      };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get(THEME_COOKIE)?.value;
  const theme = isThemeId(themeCookie) ? themeCookie : DEFAULT_THEME;
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      data-theme={theme}
      className={`${manrope.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
