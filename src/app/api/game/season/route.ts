import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";
import { seasonStandings } from "@/lib/game/seasons";

export const dynamic = "force-dynamic";

/**
 * Таблица текущего сезона.
 *
 * Смена сезона происходит здесь же, лениво: если срок вышел, seasonStandings
 * сначала подведёт итоги прошлого и откроет новый. Фонового процесса нет
 * намеренно — его пришлось бы держать живым круглосуточно, а при падении
 * доводить сезоны руками.
 */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
    return NextResponse.json(await seasonStandings());
  } catch (err) {
    return serverError((err as Error).message);
  }
}
