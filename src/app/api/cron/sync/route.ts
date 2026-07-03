import { NextResponse } from "next/server";
import { runDueSyncs } from "@/lib/sync";

export const maxDuration = 60;

// Token-protected endpoint for external cron platforms (system cron etc.).
// Secret only via "Authorization: Bearer <secret>" — query-параметр убран,
// чтобы секрет не оседал в логах прокси/туннеля.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET не задан" }, { status: 500 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const result = await runDueSyncs();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
