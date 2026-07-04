import Link from "next/link";
import { prisma } from "@/lib/db";
import { getFeedFreshness, ONLINE_THRESHOLD_MS } from "@/lib/admin";
import { getServerT } from "@/lib/i18n/server";
import { Users, Plug, AlertTriangle, Layers, Activity } from "lucide-react";

export const dynamic = "force-dynamic";

type T = (key: string, vars?: Record<string, string | number>) => string;

function lagLabel(lagMs: number, t: T): string {
  if (!isFinite(lagMs)) return t("admin.lag.none");
  const s = Math.round(lagMs / 1000);
  if (s < 60) return t("admin.lag.secAgo", { n: s });
  if (s < 3600) return t("admin.lag.minAgo", { n: Math.round(s / 60) });
  return t("admin.lag.hourAgo", { n: Math.round(s / 3600) });
}

function Stat({
  label,
  value,
  hint,
  side,
}: {
  label: string;
  value: string | number;
  hint?: string;
  // Дополнительный показатель справа (например «онлайн» у пользователей).
  side?: { label: string; value: string | number };
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs uppercase tracking-wide text-faint">{label}</div>
        {side && <div className="text-xs uppercase tracking-wide text-profit/80">{side.label}</div>}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="text-3xl font-semibold tabular-nums tracking-tight">{value}</div>
        {side && <div className="text-2xl font-semibold tabular-nums tracking-tight text-profit">{side.value}</div>}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export default async function AdminOverviewPage() {
  const { t, locale } = await getServerT();
  const nf = locale === "ru" ? "ru-RU" : "en-US";
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const monthAgo = new Date(Date.now() - 30 * 86400_000);

  const [users, online, newWeek, newMonth, accounts, syncErrors, fills] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { lastSeenAt: { gte: new Date(Date.now() - ONLINE_THRESHOLD_MS) } } }),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { createdAt: { gte: monthAgo } } }),
    prisma.exchangeAccount.count(),
    prisma.exchangeAccount.count({ where: { syncStatus: "error" } }),
    prisma.fill.count(),
  ]);

  // Число фидов берём из freshness (он же — из маленькой rollup-таблицы), чтобы
  // не делать distinct-скан по разросшейся ObSnapshot (вешал страницу).
  const freshness = await getFeedFreshness();
  const staleFeeds = freshness.filter((f) => f.stale);

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t("admin.overview.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("admin.overview.subtitle")}</p>

      {/* Алерт по карте ордеров: фиды, которые перестали наполняться. */}
      {freshness.length > 0 && (
        staleFeeds.length > 0 ? (
          <Link
            href="/admin/collector"
            className="mt-6 card p-4 border-loss/40 flex items-start gap-3 text-sm hover:border-loss/60 transition"
          >
            <AlertTriangle size={18} className="text-loss shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-loss">
                {t("admin.overview.feedsDown", { n: staleFeeds.length, total: freshness.length })}
              </div>
              <div className="mt-1 text-muted">
                {staleFeeds.map((f) => `${f.symbol}·${f.exchange} (${lagLabel(f.lagMs, t)})`).join(", ")}
              </div>
            </div>
          </Link>
        ) : (
          <div className="mt-6 card p-4 border-profit/30 flex items-center gap-3 text-sm">
            <Activity size={18} className="text-profit shrink-0" />
            <span>{t("admin.overview.feedsHealthy", { total: freshness.length })}</span>
          </div>
        )
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label={t("admin.overview.stat.users")}
          value={users}
          side={{ label: t("admin.overview.stat.online"), value: online }}
          hint={t("admin.overview.newUsersHint", { week: newWeek, month: newMonth })}
        />
        <Stat label={t("admin.overview.stat.accounts")} value={accounts} />
        <Stat
          label={t("admin.overview.stat.syncErrors")}
          value={syncErrors}
          hint={t("admin.overview.stat.syncErrorsHint")}
        />
        <Stat label={t("admin.overview.stat.fills")} value={fills.toLocaleString(nf)} />
        <Stat
          label={t("admin.overview.stat.feeds")}
          value={freshness.length}
          hint={t("admin.overview.stat.feedsHint")}
        />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link href="/admin/collector" className="card p-5 hover:border-accent/40 transition flex items-start gap-4">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent shrink-0">
            <Layers size={20} />
          </span>
          <div>
            <div className="font-medium">{t("admin.overview.cardCollector.title")}</div>
            <div className="mt-1 text-sm text-muted">{t("admin.overview.cardCollector.desc")}</div>
          </div>
        </Link>
        <Link href="/admin/users" className="card p-5 hover:border-accent/40 transition flex items-start gap-4">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent shrink-0">
            <Users size={20} />
          </span>
          <div>
            <div className="font-medium">{t("admin.overview.cardUsers.title")}</div>
            <div className="mt-1 text-sm text-muted">{t("admin.overview.cardUsers.desc")}</div>
          </div>
        </Link>
      </div>

      {syncErrors > 0 && (
        <div className="mt-6 card p-4 border-loss/30 flex items-center gap-3 text-sm">
          <AlertTriangle size={18} className="text-loss shrink-0" />
          <span>{t("admin.overview.syncErrorBanner", { n: syncErrors })}</span>
        </div>
      )}

      <div className="mt-6 text-xs text-faint flex items-center gap-2">
        <Plug size={13} /> {t("admin.overview.accessHint")}
      </div>
    </div>
  );
}
