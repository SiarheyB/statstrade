import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";

function featureDisabled() {
  return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
}

const VALID_BIAS = new Set(["breakout", "false_breakout", "neutral"]);

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const feature = await getFeatureConfig("tradeRecommendations");
  if (!feature.enabled) return featureDisabled();

  const url = new URL(req.url);
  const bias = url.searchParams.get("bias");

  try {
    const setups = await prisma.levelSetup.findMany({
      where: bias && VALID_BIAS.has(bias) ? { bias } : undefined,
      orderBy: [{ distanceAtr: "asc" }, { strength: "desc" }],
    });
    return NextResponse.json({ setups });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
