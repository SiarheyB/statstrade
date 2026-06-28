import { prisma } from "@/lib/db";
import { getServerT } from "@/lib/i18n/server";
import AccountsTable from "@/components/admin/AccountsTable";

export const dynamic = "force-dynamic";

export default async function AdminAccountsPage() {
  const { t } = await getServerT();
  const accounts = await prisma.exchangeAccount.findMany({
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
      syncIntervalMinutes: true,
      user: { select: { email: true } },
      _count: { select: { fills: true, importedTrades: true } },
    },
  });

  const rows = accounts.map((a) => ({
    id: a.id,
    userEmail: a.user.email,
    exchange: a.exchange,
    label: a.label,
    source: a.source,
    marketType: a.marketType,
    syncStatus: a.syncStatus,
    syncError: a.syncError,
    lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
    autoSync: a.autoSync,
    syncIntervalMinutes: a.syncIntervalMinutes,
    fills: a._count.fills,
    importedTrades: a._count.importedTrades,
  }));

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t("admin.accounts.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("admin.accounts.total", { n: rows.length })}</p>
      <AccountsTable rows={rows} />
    </div>
  );
}
