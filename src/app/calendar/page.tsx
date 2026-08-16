import PublicShell from "@/components/landing/PublicShell";
import EconCalPage from "@/app/dashboard/econcal/page";
import { getServerT } from "@/lib/i18n/server";

// Публичный экономический календарь — см. комментарий в /news.
export default async function PublicCalendarPage() {
  const { t } = await getServerT();
  return (
    <PublicShell title={t("landing.calendar.title")}>
      <EconCalPage />
    </PublicShell>
  );
}
