import { NextResponse } from "next/server";
import { getFeatureConfig } from "@/lib/featureConfig";
import { forbidden } from "@/lib/api";

// Общая проверка доступа к разделу «Карта ликвидаций» — используется всеми
// /api/liqmap/* роутами. Единственный переключатель из /admin/features:
// liqmap — общий выключатель, блокирует ВСЕХ, включая админа (тот же
// приём, что у forexAccess.ts).
//
// Возвращает NextResponse с ошибкой, если доступ запрещён, иначе null —
// вызывающий код делает `const denied = await liqmapAccessError(); if (denied) return denied;`
export async function liqmapAccessError(): Promise<NextResponse | null> {
  const cfg = await getFeatureConfig("liqmap");
  if (cfg && !cfg.enabled) {
    return forbidden("Раздел «Карта ликвидаций» временно отключён администратором.");
  }
  return null;
}
