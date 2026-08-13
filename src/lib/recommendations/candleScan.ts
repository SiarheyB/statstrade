/**
 * candleScan.ts — «сходи на биржу за свежими дневными свечами» перед
 * пересчётом уровней.
 *
 * С Binance общается только коллектор (у него живёт rate-limit, дедупликация
 * и запись в ObCandle), поэтому приложение не ходит на биржу само, а дёргает
 * его эндпоинт POST /scan-daily и ждёт окончания, опрашивая GET /scan-daily.
 *
 * Коллектор запрашивает свечи инкрементально — от последней сохранённой до
 * «сейчас». В обычном режиме это 1-2 дневных бара на инструмент (закрывшийся
 * вчерашний + формирующийся сегодняшний), при первом заполнении — вся глубина
 * CANDLE_RETENTION_DAYS (по умолчанию 365 баров), одним запросом на пару.
 */

const POLL_INTERVAL_MS = 2000;
// Полный проход по ~680 парам занимает ~12 минут: коллектор ходит на биржу
// последовательно и держит паузу 150 мс между парами, чтобы не упереться в
// rate-limit. Первый прогон после появления новых инструментов дольше (по ним
// тянется вся история, а не последние 1-2 бара), поэтому запас — до получаса.
const DEFAULT_TIMEOUT_MS = 30 * 60_000;

export interface CandleScanStatus {
  running: boolean;
  done: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface CandleScanResult {
  /** false — коллектор не настроен/недоступен, пересчёт идёт по тому, что есть. */
  ok: boolean;
  done: number;
  total: number;
  skippedReason?: string;
}

function collectorConfig(): { url: string; token: string } | null {
  const url = process.env.COLLECTOR_URL;
  const token = process.env.COLLECTOR_METRICS_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

async function call(url: string, token: string, method: "GET" | "POST"): Promise<CandleScanStatus & { started?: boolean }> {
  const res = await fetch(`${url}/scan-daily`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`collector /scan-daily HTTP ${res.status}`);
  return (await res.json()) as CandleScanStatus & { started?: boolean };
}

/**
 * Текущее состояние скана дневных свечей на коллекторе — без побочных
 * эффектов, только чтение. Нужно админке, чтобы показывать закачку, даже
 * когда её начали не через приложение (суточный таймер самого коллектора).
 *
 * Отражает ТОЛЬКО скан для «Рекомендаций»: прочая работа коллектора
 * (стакан, лента сделок, свечи по паре инструментов для графика) в это
 * состояние не попадает и в админке рекомендаций не показывается.
 *
 * Недоступный коллектор — не ошибка: возвращаем null, админка просто не
 * покажет строку.
 */
export async function getCandleScanStatus(): Promise<CandleScanStatus | null> {
  const cfg = collectorConfig();
  if (!cfg) return null;
  try {
    return await call(cfg.url, cfg.token, "GET");
  } catch {
    return null;
  }
}

/**
 * Запускает загрузку свежих свечей и ждёт её окончания.
 *
 * Недоступный или ненастроенный коллектор — НЕ ошибка: пересчёт всё равно
 * имеет смысл по уже собранным свечам, поэтому возвращаем ok=false с
 * причиной, а решение «считать дальше» принимает вызывающий код.
 */
export async function refreshDailyCandles(
  onProgress?: (done: number, total: number) => void,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CandleScanResult> {
  const cfg = collectorConfig();
  if (!cfg) {
    return { ok: false, done: 0, total: 0, skippedReason: "COLLECTOR_URL/COLLECTOR_METRICS_TOKEN не заданы" };
  }

  let status: CandleScanStatus;
  try {
    status = await call(cfg.url, cfg.token, "POST");
  } catch (err) {
    return { ok: false, done: 0, total: 0, skippedReason: (err as Error).message };
  }
  onProgress?.(status.done, status.total);

  const deadline = Date.now() + timeoutMs;
  while (status.running) {
    if (Date.now() > deadline) {
      return { ok: false, done: status.done, total: status.total, skippedReason: "таймаут ожидания коллектора" };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      status = await call(cfg.url, cfg.token, "GET");
    } catch (err) {
      return { ok: false, done: status.done, total: status.total, skippedReason: (err as Error).message };
    }
    onProgress?.(status.done, status.total);
  }

  if (status.error) {
    return { ok: false, done: status.done, total: status.total, skippedReason: status.error };
  }
  return { ok: true, done: status.done, total: status.total };
}
