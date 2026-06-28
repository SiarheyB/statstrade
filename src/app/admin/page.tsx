import Link from "next/link";
import { prisma } from "@/lib/db";
import { Users, Plug, AlertTriangle, Layers } from "lucide-react";

export const dynamic = "force-dynamic";

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-5">
      <div className="text-xs uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export default async function AdminOverviewPage() {
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const monthAgo = new Date(Date.now() - 30 * 86400_000);

  const [users, newWeek, newMonth, accounts, syncErrors, fills, obFeeds] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { createdAt: { gte: monthAgo } } }),
    prisma.exchangeAccount.count(),
    prisma.exchangeAccount.count({ where: { syncStatus: "error" } }),
    prisma.fill.count(),
    prisma.obSnapshot.findMany({ distinct: ["symbol", "exchange"], select: { symbol: true } }),
  ]);

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">Обзор</h1>
      <p className="mt-1 text-sm text-muted">Сводка по системе TradeStats.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Пользователи" value={users} hint={`+${newWeek} за 7 дн · +${newMonth} за 30 дн`} />
        <Stat label="Аккаунты бирж" value={accounts} />
        <Stat label="Ошибки синхронизации" value={syncErrors} hint="аккаунтов с syncStatus=error" />
        <Stat label="Исполнений (fills)" value={fills.toLocaleString("ru-RU")} />
        <Stat label="Фидов карты ордеров" value={obFeeds.length} hint="symbol × exchange в ObSnapshot" />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/admin/collector"
          className="card p-5 hover:border-accent/40 transition flex items-start gap-4"
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent shrink-0">
            <Layers size={20} />
          </span>
          <div>
            <div className="font-medium">Карта ордеров</div>
            <div className="mt-1 text-sm text-muted">
              Статус collector-сервиса и наполнение heatmap в реальном времени.
            </div>
          </div>
        </Link>
        <Link
          href="/admin/users"
          className="card p-5 hover:border-accent/40 transition flex items-start gap-4"
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent shrink-0">
            <Users size={20} />
          </span>
          <div>
            <div className="font-medium">Пользователи и аккаунты</div>
            <div className="mt-1 text-sm text-muted">Управление пользователями и синхронизацией бирж.</div>
          </div>
        </Link>
      </div>

      {syncErrors > 0 && (
        <div className="mt-6 card p-4 border-loss/30 flex items-center gap-3 text-sm">
          <AlertTriangle size={18} className="text-loss shrink-0" />
          <span>
            <span className="font-medium">{syncErrors}</span> аккаунт(ов) с ошибкой синхронизации.
          </span>
        </div>
      )}

      <div className="mt-6 text-xs text-faint flex items-center gap-2">
        <Plug size={13} /> Доступ выдаётся через переменную окружения ADMIN_EMAILS.
      </div>
    </div>
  );
}
