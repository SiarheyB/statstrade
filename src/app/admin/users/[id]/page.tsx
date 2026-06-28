import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";
import { ArrowLeft, ShieldCheck, KeyRound, Plug } from "lucide-react";
import UserDetailActions from "@/components/admin/UserDetailActions";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  idle: "text-muted",
  syncing: "text-accent",
  error: "text-loss",
};

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      twoFactorEnabled: true,
      googleId: true,
      password: true,
      _count: { select: { accounts: true, annotations: true } },
      accounts: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          exchange: true,
          label: true,
          source: true,
          marketType: true,
          syncStatus: true,
          syncError: true,
          lastSyncAt: true,
          autoSync: true,
          balance: true,
          _count: { select: { fills: true, importedTrades: true } },
        },
      },
    },
  });

  if (!user) notFound();

  const totalFills = user.accounts.reduce((s, a) => s + a._count.fills, 0);
  const totalImported = user.accounts.reduce((s, a) => s + a._count.importedTrades, 0);

  const audit = await prisma.adminAudit.findMany({
    where: { targetType: "user", targetId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const isAdmin = isAdminEmail(user.email);

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg transition">
        <ArrowLeft size={15} /> К пользователям
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            {isAdmin && <ShieldCheck size={20} className="text-accent" />}
            {user.email}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {user.name ?? "без имени"} · регистрация {user.createdAt.toLocaleDateString("ru-RU")}
          </p>
        </div>
        <UserDetailActions id={user.id} email={user.email} isAdmin={isAdmin} has2fa={user.twoFactorEnabled} />
      </div>

      {/* Профиль */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Аккаунты" value={user._count.accounts} />
        <Stat label="Исполнений (fills)" value={totalFills.toLocaleString("ru-RU")} />
        <Stat label="Импортированные" value={totalImported.toLocaleString("ru-RU")} />
        <Stat label="Аннотации" value={user._count.annotations} />
      </div>

      <div className="mt-4 card p-5 text-sm space-y-2">
        <Row label="Способ входа">
          {user.password ? "пароль" : "—"}
          {user.googleId && <span className="ml-2 text-faint">Google</span>}
        </Row>
        <Row label="2FA">
          {user.twoFactorEnabled ? (
            <span className="inline-flex items-center gap-1 text-profit"><KeyRound size={13} /> включена</span>
          ) : (
            <span className="text-faint">выключена</span>
          )}
        </Row>
        <Row label="ID">
          <span className="font-mono text-xs text-muted">{user.id}</span>
        </Row>
      </div>

      {/* Аккаунты */}
      <h2 className="mt-8 text-sm font-medium flex items-center gap-2">
        <Plug size={15} /> Аккаунты бирж
      </h2>
      <div className="mt-3 card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-faint border-b border-border">
                <th className="px-5 py-2 font-medium">Биржа / метка</th>
                <th className="px-3 py-2 font-medium">Источник</th>
                <th className="px-3 py-2 font-medium">Статус</th>
                <th className="px-3 py-2 font-medium text-right">Fills / импорт</th>
                <th className="px-3 py-2 font-medium text-right">Баланс</th>
                <th className="px-5 py-2 font-medium">Послед. синк</th>
              </tr>
            </thead>
            <tbody>
              {user.accounts.map((a) => (
                <tr key={a.id} className="border-b border-border/50 last:border-0">
                  <td className="px-5 py-2.5 whitespace-nowrap">
                    <span className="font-medium">{a.exchange}</span>
                    <span className="text-faint"> · {a.label}</span>
                    <span className="block text-[11px] text-faint">{a.marketType}</span>
                  </td>
                  <td className="px-3 py-2.5 text-muted">{a.source}</td>
                  <td className="px-3 py-2.5">
                    <span className={STATUS_STYLE[a.syncStatus] ?? "text-muted"}>{a.syncStatus}</span>
                    {a.syncError && (
                      <span className="block text-[11px] text-loss/80 max-w-[200px] truncate" title={a.syncError}>
                        {a.syncError}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                    {a._count.fills.toLocaleString("ru-RU")} / {a._count.importedTrades.toLocaleString("ru-RU")}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                    {a.balance != null ? `${a.balance.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}` : "—"}
                  </td>
                  <td className="px-5 py-2.5 text-muted whitespace-nowrap text-xs">
                    {a.lastSyncAt ? new Date(a.lastSyncAt).toLocaleString("ru-RU") : "—"}
                  </td>
                </tr>
              ))}
              {user.accounts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted">Нет аккаунтов.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Действия админов над этим пользователем */}
      <h2 className="mt-8 text-sm font-medium">История админ-действий</h2>
      <div className="mt-3 card p-5 text-sm">
        {audit.length === 0 ? (
          <div className="text-muted">Действий не было.</div>
        ) : (
          <ul className="space-y-2">
            {audit.map((a) => (
              <li key={a.id} className="flex items-center justify-between">
                <span>
                  <span className="text-muted">{a.actorEmail}</span> — {a.action}
                  {a.detail && <span className="text-faint"> ({a.detail})</span>}
                </span>
                <span className="text-xs text-faint whitespace-nowrap">{a.createdAt.toLocaleString("ru-RU")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}
