import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";

function featureDisabled() {
  return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
}

// Нейтральные сетапы не сохраняются при пересчёте (см. recompute.ts), поэтому
// и в фильтре их нет.
const VALID_BIAS = new Set(["breakout", "false_breakout"]);
const VALID_DIRECTION = new Set(["long", "short"]);

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const feature = await getFeatureConfig("tradeRecommendations");
  if (!feature.enabled) return featureDisabled();

  const url = new URL(req.url);
  const bias = url.searchParams.get("bias");
  const direction = url.searchParams.get("direction");
  const where = {
    ...(bias && VALID_BIAS.has(bias) ? { bias } : {}),
    ...(direction && VALID_DIRECTION.has(direction) ? { direction } : {}),
  };

  try {
    const setups = await prisma.levelSetup.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: [{ distanceAtr: "asc" }, { strength: "desc" }],
    });
    return NextResponse.json({ setups });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
