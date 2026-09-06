// Потолок обращений к языковой модели.
//
// Такт ботов дёргается лениво — из запросов котировок (раз в 4 секунды у
// каждого игрока) и чата (раз в 8 секунд), — и каждое такое обращение может
// уйти в OpenRouter. Это единственное место в проекте, где чужая активность
// напрямую тратит НАСТОЯЩИЕ деньги, и до этого модуля у неё не было ни
// счётчика, ни выключателя: человек, пишущий в чат «?» раз в полминуты,
// умножал расход на число открытых вкладок.
//
// Счётчик держим в памяти процесса: приложение живёт одним контейнером
// (docker-compose.prod.yml), а точность здесь не нужна — нужен предохранитель.
// Перезапуск обнуляет окно, и это правильно: после перезапуска мир должен
// заговорить, а не молчать остаток часа.

/** Сколько обращений к модели разрешено за час на весь мир. */
export const AI_CALLS_PER_HOUR = Number(process.env.GAME_AI_CALLS_PER_HOUR ?? 120);

const WINDOW_MS = 60 * 60 * 1000;
let windowStart = 0;
let used = 0;

/**
 * Занять одно обращение. `false` — потолок выбран, в модель идти нельзя.
 *
 * Бот при отказе просто молчит: молчание дешевле и выглядит естественнее, чем
 * заготовленная фраза (см. комментарий в openrouter.ts).
 */
export function takeAiCall(now = Date.now()): boolean {
  if (now - windowStart >= WINDOW_MS) {
    windowStart = now;
    used = 0;
  }
  if (used >= AI_CALLS_PER_HOUR) return false;
  used++;
  return true;
}

/** Сколько обращений уже потрачено в текущем окне — для админки и логов. */
export function aiCallsUsed(now = Date.now()): { used: number; limit: number; resetsAt: number } {
  if (now - windowStart >= WINDOW_MS) return { used: 0, limit: AI_CALLS_PER_HOUR, resetsAt: now + WINDOW_MS };
  return { used, limit: AI_CALLS_PER_HOUR, resetsAt: windowStart + WINDOW_MS };
}

/** Сброс окна — нужен тестам и ручному вмешательству админа. */
export function resetAiBudget(): void {
  windowStart = 0;
  used = 0;
}
