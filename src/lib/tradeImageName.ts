// Человекочитаемое имя файла скриншота сделки в облаке пользователя:
// СИМВОЛ_ГГГГ-ММ-ДД_ЧЧ-ММ_результат (время входа, UTC).
// Общий код для сервера (/api/trade-images — там имя реально присваивается
// файлу) и клиента (TradeImageCell показывает то же имя как подпись ссылки),
// чтобы подпись не разъезжалась с тем, что лежит в Google Drive/Я.Диске.
const RESULT_LABELS: Record<string, string> = { win: "win", loss: "loss", breakeven: "breakeven" };

// ext необязателен: на клиенте расширение неизвестно (в БД хранится только
// ссылка), там показываем имя без него.
export function buildTradeImageName(
  symbol: string | null,
  entryTimeIso: string | null,
  result: string | null,
  tradeKey: string,
  ext?: string,
): string {
  const suffix = ext ? `.${ext}` : "";
  const cleanSymbol = symbol?.trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 30);
  const entryMs = entryTimeIso ? Date.parse(entryTimeIso) : NaN;
  const resultLabel = result ? RESULT_LABELS[result] : undefined;

  if (!cleanSymbol || !Number.isFinite(entryMs) || !resultLabel) {
    return `tradestats_${tradeKey.replace(/[^a-zA-Z0-9_-]/g, "_")}${suffix}`;
  }

  const d = new Date(entryMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}`;
  return `${cleanSymbol}_${stamp}_${resultLabel}${suffix}`;
}
