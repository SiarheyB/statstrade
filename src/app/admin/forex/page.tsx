import { getServerT } from "@/lib/i18n/server";
import AdminForex from "@/components/AdminForex";
import AdminForexConfig from "@/components/AdminForexConfig";

export const dynamic = "force-dynamic";

export default async function AdminForexPage() {
  const { t } = await getServerT();
  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t("admin.forex.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("admin.forex.subtitle")}</p>
      <AdminForex />
      <AdminForexConfig />
    </div>
  );
}
