import { prisma } from "@/lib/db";
import { getServerT } from "@/lib/i18n/server";
import ContentActions from "@/components/admin/ContentActions";

export const dynamic = "force-dynamic";

function Card({
  title,
  total,
  lastUpdateText,
  extra,
  feed,
}: {
  title: string;
  total: string;
  lastUpdateText: string;
  extra?: string;
  feed: "news" | "econcal";
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{title}</div>
        <ContentActions feed={feed} />
      </div>
      <div className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{total}</div>
      <div className="mt-1 text-xs text-muted">{lastUpdateText}</div>
      {extra && <div className="mt-1 text-xs text-faint">{extra}</div>}
    </div>
  );
}

export default async function AdminContentPage() {
  const { t, locale } = await getServerT();
  const nf = locale === "ru" ? "ru-RU" : "en-US";

  const [newsTotal, newsEn, newsRu, lastNews, econTotal, lastEcon, nextEvent] = await Promise.all([
    prisma.newsItem.count(),
    prisma.newsItem.count({ where: { lang: "en" } }),
    prisma.newsItem.count({ where: { lang: "ru" } }),
    prisma.newsItem.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.economicEvent.count(),
    prisma.economicEvent.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.economicEvent.findFirst({ where: { time: { gte: new Date() } }, orderBy: { time: "asc" }, select: { title: true, time: true } }),
  ]);

  const lastUpdate = (d: Date | null) =>
    t("admin.content.lastUpdate", { date: d ? d.toLocaleString(nf) : t("admin.dash") });

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t("admin.content.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("admin.content.subtitle")}</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card
          title={t("admin.content.news")}
          total={newsTotal.toLocaleString(nf)}
          lastUpdateText={lastUpdate(lastNews?.createdAt ?? null)}
          extra={t("admin.content.newsExtra", { en: newsEn, ru: newsRu })}
          feed="news"
        />
        <Card
          title={t("admin.content.econcal")}
          total={econTotal.toLocaleString(nf)}
          lastUpdateText={lastUpdate(lastEcon?.updatedAt ?? null)}
          extra={
            nextEvent
              ? t("admin.content.nextEvent", { title: nextEvent.title, time: nextEvent.time.toLocaleString(nf) })
              : undefined
          }
          feed="econcal"
        />
      </div>
    </div>
  );
}
