import type { Metadata } from "next";
import PublicShell from "@/components/landing/PublicShell";
import NewsPage from "@/app/dashboard/news/page";
import { getServerT, getLocale } from "@/lib/i18n/server";
import { pageMetadata, SEO_PAGES } from "@/lib/seo";

// Публичная лента: тот же компонент, что в дашборде (его API теперь открыт для
// гостей — см. /api/news), в публичной обёртке. Живой контент на индексируемой
// странице, ради которого не нужно регистрироваться.
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata(SEO_PAGES.news, await getLocale());
}

export default async function PublicNewsPage() {
  const { t } = await getServerT();
  return (
    <PublicShell title={t("landing.news.title")}>
      <NewsPage />
    </PublicShell>
  );
}
