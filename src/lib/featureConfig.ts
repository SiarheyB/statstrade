import { prisma } from "@/lib/db";
import { FEATURE_DEFAULTS, type FeatureKey, type FeatureConfigValue } from "@/lib/features";

// Effective config for a feature: DB row (if any) merged over the static
// defaults. No row = feature enabled with defaults (new features are on by
// default, same pattern as ExchangeToggle).
export async function getFeatureConfig<K extends FeatureKey>(key: K): Promise<FeatureConfigValue<K>> {
  const { label: _label, ...defaults } = FEATURE_DEFAULTS[key];
  const row = await prisma.featureConfig.findUnique({ where: { key } });
  if (!row) return { enabled: true, ...defaults } as FeatureConfigValue<K>;
  let overrides: Record<string, unknown> = {};
  if (row.config) {
    try {
      overrides = JSON.parse(row.config);
    } catch {
      // corrupt config — fall back to defaults, don't crash the request
    }
  }
  return { enabled: row.enabled, ...defaults, ...overrides } as FeatureConfigValue<K>;
}

export async function getAllFeatureConfigs(): Promise<
  { key: FeatureKey; label: string; value: FeatureConfigValue<FeatureKey> }[]
> {
  const keys = Object.keys(FEATURE_DEFAULTS) as FeatureKey[];
  return Promise.all(
    keys.map(async (key) => ({
      key,
      label: FEATURE_DEFAULTS[key].label,
      value: await getFeatureConfig(key),
    })),
  );
}

export async function setFeatureConfig(
  key: FeatureKey,
  patch: { enabled?: boolean; config?: Record<string, unknown> },
): Promise<void> {
  await prisma.featureConfig.upsert({
    where: { key },
    create: {
      key,
      enabled: patch.enabled ?? true,
      config: patch.config ? JSON.stringify(patch.config) : null,
    },
    update: {
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.config !== undefined ? { config: JSON.stringify(patch.config) } : {}),
    },
  });
}
