// Такт ботов по расписанию — чтобы мир жил и тогда, когда в него не смотрят.
//
// Обычно боты ходят лениво: такт дёргается на запросах котировок, мира и
// чата. Для одного игрока за вечер этого достаточно, но у ленивой схемы есть
// провал — ночь. Человек заходит утром и видит рынок, который за десять часов
// прошёл половину графика, и ботов, которые всё это время сидели в тех же
// позициях с теми же мыслями. Мир, который замирает без зрителя, читается как
// декорация.
//
// Отсюда крон: тот же такт, тем же секретом, что и остальные задачи хоста
// (docs/SELF_HOSTING.md). Задача необязательная — без неё игра работает
// по-прежнему, просто боты ходят только при живых игроках.
import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/crypto";
import { recordCronRun } from "@/lib/cronHeartbeat";
import { ensureBots, tickBots } from "@/lib/game/bots";

export const runtime = "nodejs";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return secretEquals(req.headers.get("authorization"), `Bearer ${secret}`);
}

async function handle(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET не задан" }, { status: 500 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  // Заводим тех, кого ещё нет: на новом сервере первый же прогон населяет мир,
  // не дожидаясь, пока кто-нибудь откроет вкладку.
  const created = await ensureBots();
  const result = await tickBots();
  await recordCronRun("game.bots", "cron");
  return NextResponse.json({ ok: true, created, ...result });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
