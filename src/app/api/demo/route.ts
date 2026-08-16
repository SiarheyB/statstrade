import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { startDemoSession } from "@/lib/demoSession";

// Первый заход создаёт демо-пользователя и сеет ~140 сделок — это несколько
// секунд, дальше вход мгновенный.
export const maxDuration = 60;

// Вход в демо. POST, а не ссылка: заход меняет состояние (выдаёт cookie), и
// префетч браузера не должен его запускать. Форма на лендинге отправляется
// обычным submit — демо работает и без JS.
export async function POST(req: Request) {
  try {
    await startDemoSession();
    return NextResponse.redirect(new URL("/dashboard", req.url), { status: 303 });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
