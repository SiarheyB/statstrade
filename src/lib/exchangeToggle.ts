import { prisma } from "./db";
import { EXCHANGE_IDS, SUPPORTED_EXCHANGES, type ExchangeId, type ExchangeMeta } from "./exchanges";

// Вкл/выкл бирж для синхронизации. Отсутствие строки в ExchangeToggle = биржа
// включена (дефолт), поэтому новые биржи доступны сразу после деплоя.

type ToggleRow = { exchange: string; enabled: boolean; demoEnabled: boolean | null };

async function loadToggles(): Promise<Map<string, ToggleRow>> {
  const rows = await prisma.exchangeToggle.findMany({
    select: { exchange: true, enabled: true, demoEnabled: true },
  });
  return new Map(rows.map((r) => [r.exchange, r]));
}

// Эффективная поддержка демо: переопределение из БД или статичный дефолт.
function effectiveDemo(id: ExchangeId, row?: ToggleRow): boolean {
  return row?.demoEnabled ?? SUPPORTED_EXCHANGES[id].supportsDemo;
}

export async function isExchangeEnabled(id: ExchangeId): Promise<boolean> {
  const row = await prisma.exchangeToggle.findUnique({ where: { exchange: id }, select: { enabled: true } });
  return row?.enabled ?? true;
}

// Метаданные включённых бирж (для формы добавления аккаунта). supportsDemo —
// эффективное (с учётом админ-переопределения).
export async function getEnabledExchangeMetas(): Promise<ExchangeMeta[]> {
  const toggles = await loadToggles();
  return EXCHANGE_IDS.filter((id) => toggles.get(id)?.enabled ?? true).map((id) => ({
    ...SUPPORTED_EXCHANGES[id],
    supportsDemo: effectiveDemo(id, toggles.get(id)),
  }));
}

// Полный список с признаками enabled + demoEnabled (для админ-панели).
export async function getAllExchangeToggles(): Promise<
  (ExchangeMeta & { enabled: boolean; demoEnabled: boolean })[]
> {
  const toggles = await loadToggles();
  return EXCHANGE_IDS.map((id) => {
    const row = toggles.get(id);
    return {
      ...SUPPORTED_EXCHANGES[id],
      enabled: row?.enabled ?? true,
      demoEnabled: effectiveDemo(id, row),
    };
  });
}
