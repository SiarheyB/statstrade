import { getServerT } from "@/lib/i18n/server";
import AdminGameConfig from "@/components/AdminGameConfig";
import AdminGameStats from "@/components/AdminGameStats";

export const dynamic = "force-dynamic";

export default async function AdminGamePage() {
  const { t } = await getServerT();
  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t("admin.game.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("admin.game.subtitle")}</p>
      <div className="mt-6 space-y-10">
        <AdminGameStats />
        <AdminGameConfig />
      </div>
    </div>
  );
}
