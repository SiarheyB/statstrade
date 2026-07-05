import { prisma } from "@/lib/db";
import { FEATURE_DEFAULTS, FEATURE_META_KEYS, type FeatureKey, type FeatureConfigValue } from "@/lib/features";

// Strip the admin-facing meta fields (label/description/fieldHelp) — only the
// actual tunable values should reach app code / API responses to end users.
function stripMeta<K extends FeatureKey>(full: (typeof FEATURE_DEFAULTS)[K]): Omit<typeof full, (typeof FEATURE_META_KEYS)[number]> {
  const copy: Record<string, unknown> = { ...full };
  for (const k of FEATURE_META_KEYS) delete copy[k];
  return copy as Omit<typeof full, (typeof FEATURE_META_KEYS)[number]>;
}

// Effective config for a feature: DB row (if any) merged over the static
// defaults. No row = feature enabled with defaults (new features are on by
// default, same pattern as ExchangeToggle).
export async function getFeatureConfig<K extends FeatureKey>(key: K): Promise<FeatureConfigValue<K>> {
  const defaults = stripMeta(FEATURE_DEFAULTS[key]);
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
  {
    key: FeatureKey;
    label: string;
    description: string;
    fieldHelp: Record<string, string>;
    value: FeatureConfigValue<FeatureKey>;
  }[]
> {
  const keys = Object.keys(FEATURE_DEFAULTS) as FeatureKey[];
  return Promise.all(
    keys.map(async (key) => {
      const meta = FEATURE_DEFAULTS[key] as { description?: string; fieldHelp?: Record<string, string> };
      return {
        key,
        label: FEATURE_DEFAULTS[key].label,
        description: meta.description ?? "",
        fieldHelp: meta.fieldHelp ?? {},
        value: await getFeatureConfig(key),
      };
    }),
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
