import { NextResponse } from "next/server";
import type { SessionPayload } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { getFeatureConfig } from "@/lib/featureConfig";
import { forbidden } from "@/lib/api";

// Общая проверка доступа к разделу «Форекс» — используется всеми /api/forex/*
// роутами (кроме /api/admin/forex/*, который и так закрыт getAdminSession).
// Защищает не только UI (см. DashboardNav / dashboard/forex/page.tsx), но и
// прямые запросы к API в обход интерфейса.
//
// Два независимых переключателя из /admin/features:
//   forex             — общий выключатель, блокирует ВСЕХ, включая админа.
//   forexPublicAccess — доступ для обычных пользователей; админ не затронут.
//
// Возвращает NextResponse с ошибкой, если доступ запрещён, иначе null —
// вызывающий код должен сделать `const denied = await forexAccessError(user); if (denied) return denied;`
export async function forexAccessError(user: SessionPayload): Promise<NextResponse | null> {
  const [forex, forexPublicAccess] = await Promise.all([
    getFeatureConfig("forex"),
    getFeatureConfig("forexPublicAccess"),
  ]);
  if (!forex.enabled) {
    return forbidden("Раздел «Форекс» временно отключён администратором.");
  }
  if (!isAdminEmail(user.email) && !forexPublicAccess.enabled) {
    return forbidden("Раздел «Форекс» пока недоступен для обычных пользователей.");
  }
  return null;
}
