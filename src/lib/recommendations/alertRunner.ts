import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { alertText, decide } from "./alerts";

/**
 * alertRunner.ts — один проход проверки «цена подошла к уровню».
 *
 * Гоняется кроном раз в минуту (/api/cron/level-alerts). Вынесено из роута,
 * чтобы проход можно было вызвать и проверить отдельно от HTTP-обвязки.
 *
 * Стоимость прохода — ОДИН запрос наружу, независимо от числа подписок и
 * инструментов: Binance отдаёт цены всех бессрочных контрактов разом. Запрашивать
 * их по одному (десять инструментов — десять запросов каждую минуту, 14 400 в
 * сутки) значило бы упереться в ограничение частоты на пустом месте.
 */

const PRICES_URL = "https://fapi.binance.com/fapi/v1/ticker/price";
const FETCH_TIMEOUT_MS = 10_000;

export type AlertRunResult = {
  /** Сколько активных подписок просмотрено. */
  checked: number;
  /** По скольким отправлено уведомление. */
  fired: number;
  /** Сколько сработавших ранее подписок заряжено заново (цена ушла от уровня). */
  rearmed: number;
  /** Сколько устройств получило push. */
  pushed: number;
  error?: string;
};

/** Текущие цены всех бессрочных контрактов: символ → цена. */
async function fetchPrices(): Promise<Map<string, number>> {
  const res = await fetch(PRICES_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  const raw = (await res.json()) as { symbol?: string; price?: string }[];
  const out = new Map<string, number>();
  for (const row of Array.isArray(raw) ? raw : []) {
    const price = Number(row.price);
    if (row.symbol && Number.isFinite(price) && price > 0) out.set(row.symbol, price);
  }
  return out;
}

export async function runLevelAlerts(): Promise<AlertRunResult> {
  const result: AlertRunResult = { checked: 0, fired: 0, rearmed: 0, pushed: 0 };

  // Читаем и сработавшие тоже: им нужен обратный переход (цена ушла далеко —
  // подписка заряжается заново, см. REARM_FACTOR в alerts.ts). Без этого
  // подписка была бы одноразовой при живом на вид колокольчике.
  const alerts = await prisma.levelAlert.findMany();
  result.checked = alerts.length;
  // Ни одной подписки — наружу не ходим вовсе. Крон дёргается каждую минуту, и
  // в обычный день (никто ничего не отслеживает) это должно стоить ноль.
  if (alerts.length === 0) return result;

  let prices: Map<string, number>;
  try {
    prices = await fetchPrices();
  } catch (err) {
    // Биржа недоступна — тихо пропускаем проход. Следующий через минуту:
    // сорванная минута для уведомления о подходе к уровню не критична, а вот
    // ронять крон ошибкой значит потерять и все следующие проходы.
    return { ...result, error: (err as Error).message };
  }

  const fired: { alert: (typeof alerts)[number]; price: number }[] = [];
  const rearm: string[] = [];

  for (const a of alerts) {
    const price = prices.get(a.symbol);
    // Символа нет в выдаче — контракт сняли с торгов. Подписка просто
    // простаивает; удалять её здесь не станем, это забота владельца.
    if (price === undefined) continue;
    const what = decide({
      price,
      levelPrice: a.levelPrice,
      atr: a.atr,
      thresholdAtr: a.thresholdAtr,
      triggered: a.triggeredAt !== null,
    });
    if (what === "fire") fired.push({ alert: a, price });
    else if (what === "rearm") rearm.push(a.id);
  }

  if (rearm.length) {
    const { count } = await prisma.levelAlert.updateMany({
      where: { id: { in: rearm } },
      data: { triggeredAt: null, triggeredPrice: null },
    });
    result.rearmed = count;
  }

  if (fired.length === 0) return result;

  // Отметку ставим ДО отправки: push уходит на несколько устройств и может
  // отвечать секундами, а следующий проход крона — уже через минуту. Отметив
  // после, мы рисковали бы отправить одно и то же уведомление дважды.
  await prisma.levelAlert.updateMany({
    where: { id: { in: fired.map((f) => f.alert.id) } },
    data: { triggeredAt: new Date() },
  });
  for (const f of fired) {
    await prisma.levelAlert.update({
      where: { id: f.alert.id },
      data: { triggeredPrice: f.price },
    });
  }
  result.fired = fired.length;

  // Одна подписка — одно уведомление конкретному человеку. Схлопывать разные
  // уровни в одно сообщение нельзя: у каждого своя цена и свой сетап, и
  // «сработало 3 уведомления» не говорит трейдеру ничего.
  for (const f of fired) {
    const text = alertText({
      symbol: f.alert.symbol,
      price: f.price,
      levelPrice: f.alert.levelPrice,
      direction: f.alert.direction,
    });
    // Через notify(), а не напрямую push: уведомление должно лечь и в
    // колокольчик в меню — там человек увидит его, даже если push не дошёл.
    result.pushed += await notify(f.alert.userId, {
      kind: "level_alert",
      ...text,
      url: "/dashboard/recommendations",
      // tag по подписке: повторное уведомление по ТОМУ ЖЕ уровню заменит
      // предыдущее на экране, а не ляжет рядом второй карточкой.
      tag: `level-${f.alert.id}`,
    });
  }

  return result;
}
