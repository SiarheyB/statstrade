import { getServerT } from "@/lib/i18n/server";
import FeatureAccessToggle from "@/components/admin/FeatureAccessToggle";

export const dynamic = "force-dynamic";

// Своей внутренней конфигурации у карты ликвидаций нет: она считается на
// лету из публичных свечей биржи (см. lib/liqmap.ts), без коллектора и без
// хранимых настроек. Единственное, чем управляет админ, — включён ли раздел
// вообще, поэтому страница — один переключатель.
export default async function AdminLiqMapPage() {
  const { t } = await getServerT();
  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t("admin.liqmap.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("admin.liqmap.subtitle")}</p>
      <div className="mt-4">
        <FeatureAccessToggle featureKey="liqmap" />
      </div>
    </div>
  );
}
