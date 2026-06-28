import { prisma } from "@/lib/db";
import ContentActions from "@/components/admin/ContentActions";

export const dynamic = "force-dynamic";

function Card({
  title,
  total,
  lastAt,
  extra,
  feed,
}: {
  title: string;
  total: number;
  lastAt: Date | null;
  extra?: string;
  feed: "news" | "econcal";
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{title}</div>
        <ContentActions feed={feed} />
      </div>
      <div className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{total.toLocaleString("ru-RU")}</div>
      <div className="mt-1 text-xs text-muted">
        Последнее обновление: {lastAt ? lastAt.toLocaleString("ru-RU") : "—"}
      </div>
      {extra && <div className="mt-1 text-xs text-faint">{extra}</div>}
    </div>
  );
}

export default async function AdminContentPage() {
  const [newsTotal, newsEn, newsRu, lastNews, econTotal, lastEcon, nextEvent] = await Promise.all([
    prisma.newsItem.count(),
    prisma.newsItem.count({ where: { lang: "en" } }),
    prisma.newsItem.count({ where: { lang: "ru" } }),
    prisma.newsItem.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.economicEvent.count(),
    prisma.economicEvent.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.economicEvent.findFirst({ where: { time: { gte: new Date() } }, orderBy: { time: "asc" }, select: { title: true, time: true } }),
  ]);

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">Контент-фиды</h1>
      <p className="mt-1 text-sm text-muted">Глобальные данные: новости и экономический календарь.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card
          title="Новости"
          total={newsTotal}
          lastAt={lastNews?.createdAt ?? null}
          extra={`EN: ${newsEn} · RU: ${newsRu}`}
          feed="news"
        />
        <Card
          title="Экономический календарь"
          total={econTotal}
          lastAt={lastEcon?.updatedAt ?? null}
          extra={nextEvent ? `Ближайшее: ${nextEvent.title} — ${nextEvent.time.toLocaleString("ru-RU")}` : undefined}
          feed="econcal"
        />
      </div>
    </div>
  );
}
