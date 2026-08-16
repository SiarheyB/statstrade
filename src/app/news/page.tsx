import PublicShell from "@/components/landing/PublicShell";
import NewsPage from "@/app/dashboard/news/page";
import { getServerT } from "@/lib/i18n/server";

// Публичная лента: тот же компонент, что в дашборде (его API теперь открыт для
// гостей — см. /api/news), в публичной обёртке. Живой контент на индексируемой
// странице, ради которого не нужно регистрироваться.
export default async function PublicNewsPage() {
  const { t } = await getServerT();
  return (
    <PublicShell title={t("landing.news.title")}>
      <NewsPage />
    </PublicShell>
  );
}
