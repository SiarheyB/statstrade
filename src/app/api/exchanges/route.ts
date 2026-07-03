import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { getEnabledExchangeMetas } from "@/lib/exchangeToggle";

export const dynamic = "force-dynamic";

// Включённые биржи для формы добавления аккаунта. MetaTrader (mt4/mt5) —
// отдельный источник, добавляется на фронте всегда.
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const exchanges = await getEnabledExchangeMetas();
    return NextResponse.json({ exchanges });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
