import { prisma } from "@/lib/db";
import { isAdminEmail, ONLINE_THRESHOLD_MS } from "@/lib/admin";
import { getServerT } from "@/lib/i18n/server";
import UsersTable from "@/components/admin/UsersTable";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const { t } = await getServerT();
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      lastSeenAt: true,
      twoFactorEnabled: true,
      googleId: true,
      _count: { select: { accounts: true, annotations: true } },
    },
  });

  const rows = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    createdAt: u.createdAt.toISOString(),
    online: !!u.lastSeenAt && Date.now() - u.lastSeenAt.getTime() < ONLINE_THRESHOLD_MS,
    lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
    twoFactorEnabled: u.twoFactorEnabled,
    google: !!u.googleId,
    accounts: u._count.accounts,
    annotations: u._count.annotations,
    isAdmin: isAdminEmail(u.email),
  }));

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t("admin.users.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("admin.users.total", { n: rows.length })}</p>
      <UsersTable rows={rows} />
    </div>
  );
}
