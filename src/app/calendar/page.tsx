import type { Metadata } from "next";
import PublicShell from "@/components/landing/PublicShell";
import EconCalPage from "@/app/dashboard/econcal/page";
import { getServerT, getLocale } from "@/lib/i18n/server";
import { pageMetadata, SEO_PAGES } from "@/lib/seo";

// Публичный экономический календарь — см. комментарий в /news.
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata(SEO_PAGES.calendar, await getLocale());
}

export default async function PublicCalendarPage() {
  const { t } = await getServerT();
  return (
    <PublicShell title={t("landing.calendar.title")}>
      <EconCalPage />
    </PublicShell>
  );
}
