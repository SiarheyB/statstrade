import { NextResponse } from "next/server";
import { endDemoSession } from "@/lib/demoSession";

// Выход из демо. Единственный изменяющий запрос, который middleware пропускает
// от демо-сессии (см. middleware.ts) — иначе из демо было бы не выйти.
export async function POST(req: Request) {
  await endDemoSession();
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
