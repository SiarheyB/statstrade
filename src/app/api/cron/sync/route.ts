import { NextResponse } from "next/server";
import { runDueSyncs } from "@/lib/sync";

export const maxDuration = 300;

// Token-protected endpoint for external cron platforms (Vercel Cron, system
// cron, etc.). Accepts the secret via "Authorization: Bearer <secret>" header
// or "?secret=" query param.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret;
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
