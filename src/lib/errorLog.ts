import { prisma } from "./db";

// Централизованный лог серверных ошибок для админ-панели. Два источника пишут
// сюда: serverError() (перехваченные в try/catch API-роутов — 500-е ответы) и
// instrumentation.ts onRequestError (необработанные исключения Next.js).
//
// Throttle: одинаковое сообщение+путь не логируется чаще раза в 30с — защита
// от заливки таблицы при падающем в цикле запросе (напр. внешний фид лежит).
const THROTTLE_MS = 30_000;
const lastLogged = new Map<string, number>();

// Ключ троттлинга — это путь + ТЕКСТ ошибки, а текст часто уникален (в нём
// оседают id, символы, адреса). Без подметания Map растёт по одной записи на
// каждое непохожее сообщение и не уменьшается никогда, а app-контейнер живёт
// неделями. Записи старше окна троттлинга уже ни на что не влияют — выносим их.
// Тот же приём, что в lib/ratelimit.ts и lib/cache.ts; здесь его не было.
const SWEEP_EVERY_MS = 60_000;
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [k, at] of lastLogged) {
    if (now - at >= THROTTLE_MS) lastLogged.delete(k);
  }
}

/** Только для тестов: сколько ключей троттлинга сейчас в памяти. */
export function throttleSize(): number {
  return lastLogged.size;
}

export function logError(message: string, opts: { path?: string; stack?: string } = {}): void {
  const key = `${opts.path ?? ""}:${message}`;
  const now = Date.now();
  sweep(now);
  const prev = lastLogged.get(key) ?? 0;
  if (now - prev < THROTTLE_MS) return;
  lastLogged.set(key, now);
  // Fire-and-forget: логирование не должно ломать или задерживать ответ.
  prisma.errorLog
    .create({
      data: {
        message: message.slice(0, 4000),
        path: opts.path?.slice(0, 500) ?? null,
        stack: opts.stack?.slice(0, 8000) ?? null,
      },
    })
    .catch(() => {
      // если сама запись лога упала — молча игнорируем, чтобы не зациклиться
    });
}

/** Сколько суток держим записи. 0 или мусор — дефолт. */
export function errorLogRetentionDays(): number {
  const n = Number(process.env.ERRORLOG_RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 90;
}

/**
 * Чистка старых записей — раз в сутки из /api/cron/analytics.
 *
 * Раньше автоочистки не было вовсе («ручное удаление» в комментарии к модели),
 * при этом сюда пишет не только serverError(), но и оповещения о трафике
 * (lib/traffic/alerts.ts) — то есть таблица пополняется и без единой ошибки.
 * Ошибка трёхмесячной давности ничего не диагностирует, а бейдж «непрочитанные»
 * считается по свежим.
 */
export async function pruneErrorLog(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - errorLogRetentionDays() * 86_400_000);
  try {
    const { count } = await prisma.errorLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return count;
  } catch {
    // чистка лога не имеет права ронять крон свёртки
    return 0;
  }
}
