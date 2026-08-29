import { prisma } from "@/lib/db";
import { FEATURE_DEFAULTS, FEATURE_META_KEYS, type FeatureKey, type FeatureConfigValue } from "@/lib/features";

// Strip the admin-facing meta fields (label/description/fieldHelp) — only the
// actual tunable values should reach app code / API responses to end users.
function stripMeta<K extends FeatureKey>(full: (typeof FEATURE_DEFAULTS)[K]): Omit<typeof full, (typeof FEATURE_META_KEYS)[number]> {
  const copy: Record<string, unknown> = { ...full };
  for (const k of FEATURE_META_KEYS) delete copy[k];
  return copy as Omit<typeof full, (typeof FEATURE_META_KEYS)[number]>;
}

// Строки таблицы целиком, с коротким кэшем.
//
// Флаги читаются на горячих путях: forexAccess() и recommendationsAccess()
// спрашивают по ДВА флага, а /api/forex дёргает их на каждом опросе (раз в
// 3 секунды на открытую вкладку). Без кэша это два запроса в БД на тик ради
// значения, которое меняется раз в месяц кнопкой в админке.
//
// Кэшируем всю таблицу, а не отдельный ключ: строк в ней единицы, один
// findMany дешевле любой выборки по одному ключу и сразу закрывает
// getAllFeatureConfigs.
const CACHE_MS = 15_000;
type FeatureRows = Map<string, { enabled: boolean; config: string | null }>;
let cache: { at: number; rows: FeatureRows } | null = null;
// Запрос «в полёте»: getAllFeatureConfigs спрашивает все ключи через
// Promise.all, и на холодном кэше каждый увидел бы пустоту одновременно —
// столько же findMany, сколько флагов. Общий промис делает из них один.
let inflight: Promise<FeatureRows> | null = null;

async function featureRows(): Promise<FeatureRows> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.rows;
  if (inflight) return inflight;
  const own = prisma.featureConfig
    .findMany({ select: { key: true, enabled: true, config: true } })
    .then((rows) => {
      const map: FeatureRows = new Map(
        rows.map((r) => [r.key, { enabled: r.enabled, config: r.config }]),
      );
      // Только если этот запрос всё ещё «наш»: между стартом и ответом мог
      // пройти invalidateFeatureCache (правка из админки), и тогда наши строки
      // уже устарели — класть их в кэш нельзя.
      if (inflight === own) cache = { at: Date.now(), rows: map };
      return map;
    })
    .finally(() => {
      if (inflight === own) inflight = null;
    });
  inflight = own;
  return own;
}

/** Сбросить кэш — после правки из админки значение должно примениться сразу. */
export function invalidateFeatureCache(): void {
  cache = null;
  // И запрос «в полёте»: он стартовал ДО записи, а его .then положил бы в кэш
  // дозаписные строки — тумблер из админки «отыграл бы назад» на 15 секунд.
  // Обнуляем ссылку: запрос честно доработает и вернёт значение своему
  // вызывающему, но кэш заполнять ему уже нечем (проверка inflight === own).
  inflight = null;
}

// Effective config for a feature: DB row (if any) merged over the static
// defaults. No row = feature enabled with defaults (new features are on by
// default, same pattern as ExchangeToggle).
export async function getFeatureConfig<K extends FeatureKey>(key: K): Promise<FeatureConfigValue<K>> {
  const defaults = stripMeta(FEATURE_DEFAULTS[key]);
  const row = (await featureRows()).get(key);
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
  // Иначе тумблер в админке «не срабатывал» бы до 15 секунд.
  invalidateFeatureCache();
}
