// Сезоны.
//
// Вечный рейтинг мёртв для новичка: пришедший через месяц не догонит первых
// никогда и перестаёт смотреть в таблицу вообще. Сезон длится четыре недели,
// считает только то, что игрок сделал ЗА ЭТОТ СРОК, и заканчивается — то
// есть даёт и повод начать (все стартуют с нуля), и повод вернуться к дате.
//
// Что сезон НЕ трогает: престиж, пройденные испытания, перки, открытые
// рынки, деньги. Обнулять пройденный путь — значит наказывать человека за
// то, что он играл давно. Сезонным является только ЗАЧЁТ ДОХОДНОСТИ.
//
// Смена сезона происходит лениво, при первом обращении после срока, — тем же
// приёмом, что и генерация рынка. Фоновый процесс пришлось бы держать живым
// круглосуточно, а при падении — доводить сезоны руками.
import { prisma } from "@/lib/db";

export const SEASON_LENGTH_DAYS = 28;
/** Сколько мест получают награду. */
export const SEASON_PRIZE_PLACES = 10;
/** Награда за первое место; дальше убывает. */
export const SEASON_TOP_PRIZE = 25_000;
/** Престиж первому месту. */
export const SEASON_TOP_PRESTIGE = 50;
/**
 * Ниже этого числа участников сезон закрывается БЕЗ наград.
 *
 * Иначе в пустом мире первое место достаётся единственному зашедшему просто
 * за факт присутствия, и награда перестаёт что-либо значить.
 */
export const SEASON_MIN_PLAYERS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Награда за место: первое берёт полную ставку, дальше по убыванию. */
export function seasonPrize(rank: number): { cash: number; prestige: number } {
  if (rank < 1 || rank > SEASON_PRIZE_PLACES) return { cash: 0, prestige: 0 };
  const share = 1 / rank;
  return {
    cash: Math.round(SEASON_TOP_PRIZE * share),
    prestige: Math.max(1, Math.round(SEASON_TOP_PRESTIGE * share)),
  };
}

/** Результат сезона в процентах роста от входной эквити. */
export function seasonReturnPct(equity: number, startEquity: number | null): number {
  if (startEquity == null || startEquity <= 0) return 0;
  return ((equity - startEquity) / startEquity) * 100;
}

/**
 * Текущий сезон. Если срок вышел — подводит итоги прошлого и открывает
 * следующий. Если сезонов ещё нет — заводит первый.
 */
export async function currentSeason(now = Date.now()) {
  const latest = await prisma.gameSeason.findFirst({ orderBy: { index: "desc" } });
  if (!latest) return startSeason(1, now);
  if (latest.endsAt.getTime() > now) return latest;

  await closeSeason(latest.id);
  // Между концом прошлого сезона и «сейчас» мог пройти не один срок (мир мог
  // простоять). Отсчитываем новый от текущего момента, а не от конца
  // прошлого: сезон, который начался и кончился, пока никто не заходил,
  // никому не нужен.
  return startSeason(latest.index + 1, now);
}

async function startSeason(index: number, now: number) {
  const startedAt = new Date(now);
  const endsAt = new Date(now + SEASON_LENGTH_DAYS * DAY_MS);
  // Уникальный индекс защищает от гонки: два одновременных запроса могли
  // начать один и тот же сезон — второй наткнётся на индекс и прочитает
  // уже созданный.
  try {
    return await prisma.gameSeason.create({ data: { index, startedAt, endsAt } });
  } catch {
    const existing = await prisma.gameSeason.findUnique({ where: { index } });
    if (existing) return existing;
    throw new Error("Не удалось начать сезон");
  }
}

/**
 * Подвести итоги сезона: расставить места, начислить награды, записать
 * результаты. Идемпотентна — повторный вызов ничего не удвоит.
 */
export async function closeSeason(seasonId: string) {
  const season = await prisma.gameSeason.findUnique({ where: { id: seasonId } });
  if (!season || season.closedAt) return;

  const players = await prisma.gamePlayer.findMany({
    where: { seasonId, seasonStartEquity: { not: null }, isPublic: true },
    select: { id: true, nickname: true, equity: true, seasonStartEquity: true },
  });

  const ranked = players
    .map((p) => ({ ...p, returnPct: seasonReturnPct(p.equity, p.seasonStartEquity) }))
    .sort((a, b) => b.returnPct - a.returnPct);

  const withPrizes = ranked.length >= SEASON_MIN_PLAYERS;
  // Награду получает только тот, кто закончил сезон в плюсе. Иначе в
  // немноголюдном сезоне деньги достаются игроку, который слил счёт, просто
  // за то, что слил меньше остальных, — и приз перестаёт что-то значить.
  const paid = (rank: number, returnPct: number) =>
    withPrizes && returnPct > 0 && rank <= SEASON_PRIZE_PLACES ? seasonPrize(rank) : { cash: 0, prestige: 0 };

  // Закрываем сезон ПЕРВЫМ действием транзакции: даже если начисление
  // упадёт, сезон не будет подводиться заново по кругу.
  await prisma.$transaction([
    prisma.gameSeason.update({ where: { id: seasonId }, data: { closedAt: new Date() } }),
    ...ranked.map((p, i) => {
      const prize = paid(i + 1, p.returnPct);
      return prisma.gameSeasonResult.create({
        data: {
          seasonId,
          playerId: p.id,
          rank: i + 1,
          returnPct: p.returnPct,
          equity: p.equity,
          reward: prize.cash,
        },
      });
    }),
    ...ranked
      .map((p, i) => ({ p, prize: paid(i + 1, p.returnPct) }))
      .filter(({ prize }) => prize.cash > 0)
      .map(({ p, prize }) => {
      return prisma.gamePlayer.update({
        where: { id: p.id },
        data: {
          // Деньги — в очередь на получение, тем же каналом, что проценты по
          // займам: сервер игровой баланс не хранит.
          pendingPayout: { increment: prize.cash },
          prestige: { increment: prize.prestige },
        },
      });
    }),
    // Все входят в новый сезон заново: отметка входной эквити ставится при
    // первой же синхронизации.
    prisma.gamePlayer.updateMany({ where: { seasonId }, data: { seasonId: null, seasonStartEquity: null } }),
  ]);

  if (withPrizes && ranked.length > 0 && ranked[0].returnPct > 0) {
    // Событие пишем напрямую, а не через world.recordEvent: world вызывает
    // joinSeason, и импорт обратно замкнул бы модули кольцом.
    await prisma.gameWorldEvent.create({
      data: {
        playerId: ranked[0].id,
        kind: "season_won",
        payload: JSON.stringify({
          nickname: ranked[0].nickname,
          season: season.index,
          resultPct: Math.round(ranked[0].returnPct * 10) / 10,
        }),
      },
    });
  }
}

/**
 * Записать игрока в текущий сезон, если его там ещё нет.
 *
 * Входная эквити фиксируется в момент первого захода в сезон — с неё и
 * считается рост. Возвращает сезон и отметку.
 */
export async function joinSeason(playerId: string, equity: number, now = Date.now()) {
  const season = await currentSeason(now);
  const player = await prisma.gamePlayer.findUnique({
    where: { id: playerId },
    select: { seasonId: true, seasonStartEquity: true },
  });
  if (player?.seasonId === season.id && player.seasonStartEquity != null) {
    return { season, startEquity: player.seasonStartEquity };
  }
  await prisma.gamePlayer.update({
    where: { id: playerId },
    data: { seasonId: season.id, seasonStartEquity: equity },
  });
  return { season, startEquity: equity };
}

/** Таблица текущего сезона: кто сколько сделал ЗА СЕЗОН. */
export async function seasonStandings(limit = 25, now = Date.now()) {
  const season = await currentSeason(now);
  const players = await prisma.gamePlayer.findMany({
    where: { seasonId: season.id, seasonStartEquity: { not: null }, isPublic: true },
    select: {
      id: true,
      nickname: true,
      rankKey: true,
      equity: true,
      seasonStartEquity: true,
      activeStyle: true,
      contractsPassed: true,
    },
  });
  const rows = players
    .map((p) => ({
      id: p.id,
      nickname: p.nickname,
      rankKey: p.rankKey,
      activeStyle: p.activeStyle,
      contractsPassed: p.contractsPassed,
      returnPct: seasonReturnPct(p.equity, p.seasonStartEquity),
    }))
    .sort((a, b) => b.returnPct - a.returnPct)
    .slice(0, limit);

  return {
    season: {
      index: season.index,
      startedAt: season.startedAt.getTime(),
      endsAt: season.endsAt.getTime(),
      players: players.length,
      minPlayers: SEASON_MIN_PLAYERS,
    },
    rows,
  };
}
