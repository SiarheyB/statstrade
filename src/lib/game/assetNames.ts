// Тикер по идентификатору инструмента — для мест, где на руках только id.
//
// Отдельный модуль, потому что чат и лента мира живут на клиенте и не могут
// тянуть `marketStore`: тот работает с Prisma. Здесь только справочник.
import assetsData from "@/data/assets.json";

const SYMBOL_BY_ID = new Map<string, string>(
  (assetsData as Array<{ id: string; symbol: string }>).map((a) => [a.id, a.symbol]),
);

export function symbolOf(assetId: string): string {
  return SYMBOL_BY_ID.get(assetId) ?? assetId;
}
