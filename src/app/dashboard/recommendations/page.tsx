import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { getSession } from "@/lib/auth";
import { isAdminSession } from "@/lib/admin";
import { getFeatureConfig } from "@/lib/featureConfig";
import RecommendationsView from "./RecommendationsView";

export const dynamic = "force-dynamic";

// Серверная проверка доступа к разделу «Рекомендации» — защищает не только
// пункт меню (см. DashboardNav), но и прямой заход по URL. Тот же приём, что
// и у форекса (см. dashboard/forex/page.tsx): два независимых переключателя
// из /admin/features:
//   tradeRecommendations             — общий выключатель, скрыт даже для админа.
//   tradeRecommendationsPublicAccess — доступ для обычных пользователей; админ
//                                      видит раздел в любом случае.
function AccessDenied({ text }: { text: string }) {
  return (
    <div className="p-6 md:p-8 max-w-2xl">
      <div className="card p-6 flex items-start gap-3 border-loss/30">
        <ShieldAlert size={24} className="text-loss shrink-0 mt-0.5" />
        <div>
          <div className="font-medium text-fg">Доступ запрещён</div>
          <p className="mt-1 text-sm text-muted">{text}</p>
        </div>
      </div>
    </div>
  );
}

export default async function RecommendationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const admin = isAdminSession(session);

  const [tradeRecommendations, publicAccess] = await Promise.all([
    getFeatureConfig("tradeRecommendations"),
    getFeatureConfig("tradeRecommendationsPublicAccess"),
  ]);

  if (!tradeRecommendations.enabled) {
    return <AccessDenied text="Раздел «Рекомендации» временно отключён администратором." />;
  }
  if (!admin && !publicAccess.enabled) {
    return <AccessDenied text="Раздел «Рекомендации» пока недоступен для обычных пользователей." />;
  }

  return <RecommendationsView />;
}
