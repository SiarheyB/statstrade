import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";
import { getMarket } from "@/lib/game/marketStore";

export const dynamic = "force-dynamic";

/**
 * Параметры мира: сид и момент его создания.
 *
 * Нужны клиенту, чтобы считать ТИКИ самому. Раньше «текущая» свеча ждала
 * ответа сервера и появлялась палкой раз в несколько секунд; теперь браузер
 * достраивает цену внутри минуты тем же детерминированным путём, что и
 * сервер, — без единого лишнего запроса и с гарантией, что к закрытию минуты
 * они сойдутся до цента.
 *
 * Сид не секрет: он и так виден в админке, а предсказать по нему будущее
 * нельзя — история строится вперёд только до текущего часа, а новости и
 * режимы считаются на сервере.
 */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
    const market = await getMarket();
    return NextResponse.json({ seed: market.seed, startedAt: market.startedAt.getTime(), now: Date.now() });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
