import { prisma } from "./db";

// Централизованный лог серверных ошибок для админ-панели. Два источника пишут
// сюда: serverError() (перехваченные в try/catch API-роутов — 500-е ответы) и
// instrumentation.ts onRequestError (необработанные исключения Next.js).
//
// Throttle: одинаковое сообщение+путь не логируется чаще раза в 30с — защита
// от заливки таблицы при падающем в цикле запросе (напр. внешний фид лежит).
const THROTTLE_MS = 30_000;
const lastLogged = new Map<string, number>();

export function logError(message: string, opts: { path?: string; stack?: string } = {}): void {
  const key = `${opts.path ?? ""}:${message}`;
  const now = Date.now();
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
