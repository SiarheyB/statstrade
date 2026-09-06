import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, serverError, tooManyRequests } from "@/lib/api";
import { checkGameLimit } from "@/lib/game/limits";
import { getFeatureConfig } from "@/lib/featureConfig";
import { getMarket } from "@/lib/game/marketStore";
import { deriveTickKey, tickHourIndex, tickKeyExpiry } from "@/lib/game/tickKey";

export const dynamic = "force-dynamic";

/**
 * Параметры мира для клиента: ключ тиков и момент создания.
 *
 * Клиент достраивает цену ВНУТРИ минуты сам — иначе последняя свеча ждала бы
 * ответа сервера и появлялась палкой раз в несколько секунд.
 *
 * СИД ОТСЮДА УБРАН, и это не перестраховка. Генератор рынка — чистая функция,
 * и она едет в браузерный бандл вместе с живым тиком: с сидом на руках игрок
 * считал не текущую минуту, а любой будущий час по любому инструменту
 * (проверено реплеем — 293 из 300 баров совпадали точь-в-точь). Вместо сида
 * уходит односторонний ключ на ОДИН ЧАС: внутри минуты он даёт ту же
 * случайность, а к сиду и к следующему часу не ведёт.
 */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const wait = checkGameLimit(user.userId, "read");
  if (wait) return tooManyRequests(wait);
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
    const market = await getMarket();
    const now = Date.now();
    const hour = tickHourIndex(now);
    return NextResponse.json({
      tickKey: deriveTickKey(market.seed, hour),
      // Клиент по этому времени поймёт, что пора за новым ключом: следующий
      // час считается уже другой строкой.
      tickKeyExpiresAt: tickKeyExpiry(hour),
      startedAt: market.startedAt.getTime(),
      now,
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
