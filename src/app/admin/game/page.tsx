import { getServerT } from "@/lib/i18n/server";
import AdminGameTabs from "@/components/admin/game/AdminGameTabs";

export const dynamic = "force-dynamic";

export default async function AdminGamePage() {
  const { t } = await getServerT();
  return (
    <div className="p-6 md:p-8 max-w-7xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t("admin.game.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("admin.game.subtitle")}</p>
      <div className="mt-6">
        <AdminGameTabs />
      </div>
    </div>
  );
}
