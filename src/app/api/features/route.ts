import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";
import { FEATURE_DEFAULTS, type FeatureKey } from "@/lib/features";

function isFeatureKey(v: string | null): v is FeatureKey {
  return !!v && v in FEATURE_DEFAULTS;
}

// Read-only effective config for one feature, for any authenticated user —
// client code checks this before running an optional/toggleable feature
// (e.g. exit-efficiency analytics). Admin-only mutation is /api/admin/features.
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const key = new URL(req.url).searchParams.get("key");
  if (!isFeatureKey(key)) return badRequest("Неизвестная фича");

  try {
    const value = await getFeatureConfig(key);
    return NextResponse.json({ key, value });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
