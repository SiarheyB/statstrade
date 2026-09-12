import { NextResponse } from "next/server";
import { getFeatureConfig } from "@/lib/featureConfig";
import { forbidden } from "@/lib/api";

// Общая проверка доступа к разделу «Карта ордеров» — используется всеми
// /api/orderflow/* роутами. Единственный переключатель из /admin/features:
// orderflow — общий выключатель, блокирует ВСЕХ, включая админа (тот же
// приём, что у forexAccess.ts).
//
// Возвращает NextResponse с ошибкой, если доступ запрещён, иначе null —
// вызывающий код делает `const denied = await orderflowAccessError(); if (denied) return denied;`
export async function orderflowAccessError(): Promise<NextResponse | null> {
  const cfg = await getFeatureConfig("orderflow");
  if (cfg && !cfg.enabled) {
    return forbidden("Раздел «Карта ордеров» временно отключён администратором.");
  }
  return null;
}
