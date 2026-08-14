import { NextResponse } from "next/server";
import type { SessionPayload } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { getFeatureConfig } from "@/lib/featureConfig";
import { forbidden } from "@/lib/api";

// Общая проверка доступа к разделу «Рекомендации» — используется всеми
// /api/recommendations/* роутами (кроме /api/admin/recommendations, который и
// так закрыт getAdminSession). Защищает не только UI (см. DashboardNav /
// dashboard/recommendations/page.tsx), но и прямые запросы к API в обход
// интерфейса. Тот же приём, что и у форекса (см. forexAccess.ts).
//
// Два независимых переключателя из /admin/features:
//   tradeRecommendations             — общий выключатель, блокирует ВСЕХ, включая админа.
//   tradeRecommendationsPublicAccess — доступ для обычных пользователей; админ не затронут.
//
// Возвращает NextResponse с ошибкой, если доступ запрещён, иначе null —
// вызывающий код должен сделать `const denied = await recommendationsAccessError(user); if (denied) return denied;`
export async function recommendationsAccessError(user: SessionPayload): Promise<NextResponse | null> {
  const [tradeRecommendations, publicAccess] = await Promise.all([
    getFeatureConfig("tradeRecommendations"),
    getFeatureConfig("tradeRecommendationsPublicAccess"),
  ]);
  if (!tradeRecommendations.enabled) {
    return forbidden("Раздел «Рекомендации» временно отключён администратором.");
  }
  if (!isAdminEmail(user.email) && !publicAccess.enabled) {
    return forbidden("Раздел «Рекомендации» пока недоступен для обычных пользователей.");
  }
  return null;
}
