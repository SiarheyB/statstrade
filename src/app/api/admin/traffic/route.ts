// Данные раздела «Трафик» для клиентских виджетов: блок «сейчас на сайте»
// обновляется опросом, страница целиком при этом не перерисовывается.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getLive } from "@/lib/traffic/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  return NextResponse.json(await getLive());
}
