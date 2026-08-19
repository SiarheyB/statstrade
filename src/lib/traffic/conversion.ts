// Отметка конверсии на текущем визите: «этот заход закончился регистрацией».
//
// Держим отдельно от ingest.ts, потому что здесь нужен next/headers (доступ к
// cookie визита) — а ingest.ts должен оставаться просто функцией над данными,
// вызываемой в том числе из тестов.

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./hit";
import { markConversion } from "./ingest";

/** Fire-and-forget: конверсия не должна задерживать вход/регистрацию. */
export async function trackConversion(kind: "registered" | "loggedIn", userId?: string | null): Promise<void> {
  try {
    const sid = (await cookies()).get(SESSION_COOKIE)?.value;
    await markConversion(sid, kind, userId);
  } catch {
    // визита нет — сбор выключен или запрос пришёл без cookie
  }
}
