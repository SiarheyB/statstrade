// Боты живут всегда, а не пока на них смотрят.
//
// Сначала такт был ленивым: боты шевелились на запросах котировок, мира и
// чата. Для одного вечера этого хватало, но мир, который замирает без
// зрителя, — не мир, а декорация: человек уходил спать, возвращался утром и
// видел рынок, прошедший половину графика, и ботов в тех же позициях с теми
// же мыслями. Их счета не менялись, рейтинг стоял, чат молчал.
//
// Поэтому у ботов теперь свой цикл в процессе приложения. Он идёт ровно так
// же, когда в игре нет ни одного человека: раз в BOT_TICK_MS каждый бот
// смотрит на рынок и решает, что делать.
//
// ПОЧЕМУ ЗДЕСЬ, А НЕ В ОБЩЕМ ПЛАНИРОВЩИКЕ (lib/scheduler.ts): тот на проде
// выключен (ENABLE_SCHEDULER=false — синхронизацию гоняет системный крон
// хоста), а боты должны ходить именно на проде. Ленивые такты на запросах
// при этом остались: они безобидны (такт сам себя ограничивает по времени
// последнего хода) и оживляют мир сразу, не дожидаясь очередного оборота.
import { BOT_TICK_MS } from "@/lib/game/bots";

let started = false;

/** Через сколько после старта процесса пойдёт первый такт. */
export const FIRST_TICK_DELAY_MS = 15_000;

/** Выключен ли цикл окружением. Это деньги на OpenRouter — рубильник нужен. */
export function botLoopDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GAME_BOTS_LIVE === "false";
}

/** Как часто убираем старые данные. */
export const PURGE_EVERY_MS = 60 * 60 * 1000;
let lastPurgeAt = 0;

/** Один оборот: завести недостающих ботов и дать всем походить. */
export async function botLoopTick(now = Date.now()): Promise<void> {
  const [{ getFeatureConfig }, { ensureBots, tickBots }, { recordCronRun }, { purgeExpiredChats }, { purgeOldMarketData }] =
    await Promise.all([
      import("@/lib/featureConfig"),
      import("@/lib/game/bots"),
      import("@/lib/cronHeartbeat"),
      import("@/lib/game/social"),
      import("@/lib/game/marketStore"),
    ]);

  // Раздел выключен админом — мир стоит целиком, и боты вместе с ним. Иначе
  // выключенная игра продолжала бы тратить деньги на токены.
  const game = await getFeatureConfig("game");
  if (!game.enabled) return;

  await ensureBots();
  // Заодно стираем каналы, у которых вышел срок. Это единственное место,
  // которое работает и без игроков: чат, доживший до очистки в ночь, когда
  // никто не заходил, должен очиститься сам.
  const cleared = await purgeExpiredChats();
  for (const row of cleared) {
    console.log(`[game-bots] чат «${row.channel}» очищен: ${row.removed} сообщений`);
  }
  // Чистка старых свечей, новостей и ленты мира — раз в час, а не каждый
  // такт: удалять по одной минуте нечего, а лишний DELETE по большой таблице
  // на слабом сервере заметен. Без этой уборки таблица свечей растёт вечно.
  if (now - lastPurgeAt >= PURGE_EVERY_MS) {
    lastPurgeAt = now;
    const removed = await purgeOldMarketData();
    if (removed.candles + removed.news + removed.events > 0) {
      console.log(
        `[game-bots] убрано старого: свечей ${removed.candles}, новостей ${removed.news}, событий ${removed.events}`,
      );
    }
  }

  const result = await tickBots();
  if (result.moved > 0 || result.spoke > 0) {
    await recordCronRun("game.bots", "scheduler");
  }
}

/**
 * Запустить цикл. Идемпотентна: в dev-режиме модуль перезагружается, и без
 * флага таймеров накопилось бы по одному на перезагрузку.
 */
export function startBotLoop(): void {
  if (started || botLoopDisabled()) return;
  started = true;

  const tick = () => {
    void botLoopTick().catch((err) => {
      console.error("[game-bots] ошибка такта:", (err as Error).message);
    });
  };

  // Первый такт не сразу: старт процесса и так занят прогревом, миграциями и
  // первыми запросами — незачем добавлять к ним поход в языковую модель.
  setTimeout(tick, FIRST_TICK_DELAY_MS);
  setInterval(tick, BOT_TICK_MS);
  console.log("[game-bots] цикл запущен");
}
