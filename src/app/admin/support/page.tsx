import { getServerT } from "@/lib/i18n/server";
import AdminSupport from "@/components/AdminSupport";

export const dynamic = "force-dynamic";

export default async function AdminSupportPage() {
  const { t } = await getServerT();
  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t("admin.support.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("admin.support.subtitle")}</p>
      <AdminSupport />
    </div>
  );
}
