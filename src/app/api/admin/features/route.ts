import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";
import { getAllFeatureConfigs, setFeatureConfig } from "@/lib/featureConfig";
import { FEATURE_DEFAULTS, type FeatureKey } from "@/lib/features";

export const dynamic = "force-dynamic";

function isFeatureKey(v: string): v is FeatureKey {
  return v in FEATURE_DEFAULTS;
}

export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const features = await getAllFeatureConfigs();
    return NextResponse.json({ features });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const schema = z
  .object({
    key: z.string().min(1).max(60),
    enabled: z.boolean().optional(),
    config: z.record(z.string(), z.number()).optional(),
  })
  .refine((v) => v.enabled !== undefined || v.config !== undefined, {
    message: "Нужно указать enabled или config",
  });

export async function PATCH(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Проверьте данные");
  const { key, enabled, config } = parsed.data;
  if (!isFeatureKey(key)) return badRequest("Неизвестная фича");

  try {
    await setFeatureConfig(key, { enabled, config });
    await recordAudit(session, "feature.config", {
      targetType: "FeatureConfig",
      targetId: key,
      detail: [
        enabled !== undefined ? `enabled=${enabled}` : null,
        config ? Object.entries(config).map(([k, v]) => `${k}=${v}`).join(", ") : null,
      ].filter(Boolean).join("; "),
    });
    const features = await getAllFeatureConfigs();
    return NextResponse.json({ features });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
