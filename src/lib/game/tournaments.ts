// Турниры.
//
// Сезон длится месяц, общий рейтинг не кончается вовсе — а игроку нужна и
// короткая дистанция: зашёл, три дня поторговал, увидел итог. Турнир этим и
// отличается: у него есть вход, понятный конец и призовой фонд, собранный
// самими участниками.
//
// Взнос обязателен и это не украшение. Без него турнир превращается в
// бесплатную лотерею, куда выгодно записаться и не играть: вдруг повезёт.
// Заплатив, человек играет — а призовой фонд, собранный из взносов, честнее
// любых выдуманных денег, потому что его размер зависит от того, сколько
// людей пришло.
//
// Жизненный цикл ленивый, как у сезонов и рынка: турнир закрывается и
// открывается при первом обращении после срока. Фоновый процесс пришлось бы
// держать живым круглосуточно и доводить турниры руками после каждого сбоя.
import { prisma } from "@/lib/db";

/** Сколько длится турнир. */
export const TOURNAMENT_DAYS = 3;
/** Взнос за участие. */
export const TOURNAMENT_ENTRY_FEE = 5_000;
/** Сколько мест делят призовой фонд. */
export const TOURNAMENT_PRIZE_PLACES = 3;
/** Доли призового фонда по местам. */
export const TOURNAMENT_PRIZE_SHARES = [0.5, 0.3, 0.2];
/**
 * Меньше этого числа участников — фонд возвращается всем, кто заплатил.
 *
 * Турнир из двух человек это не соревнование, а обмен взносами, где один
 * забирает деньги другого просто за то, что пришёл.
 */
export const TOURNAMENT_MIN_PLAYERS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export type TournamentError = "already_joined" | "finished" | "not_found";
export type TournamentResult<T> = { ok: true; value: T } | { ok: false; error: TournamentError };

/** Доля призового фонда за место. */
export function prizeShare(rank: number): number {
  return TOURNAMENT_PRIZE_SHARES[rank - 1] ?? 0;
}

export function returnPct(equity: number, startEquity: number): number {
  if (!(startEquity > 0)) return 0;
  return ((equity - startEquity) / startEquity) * 100;
}

/** Текущий турнир: закрывает прошедший и открывает следующий. */
export async function currentTournament(now = Date.now()) {
  const latest = await prisma.gameTournament.findFirst({ orderBy: { index: "desc" } });
  if (!latest) return startTournament(1, now);
  if (latest.endsAt.getTime() > now) return latest;

  await closeTournament(latest.id);
  return startTournament(latest.index + 1, now);
}

async function startTournament(index: number, now: number) {
  const data = {
    index,
    startsAt: new Date(now),
    endsAt: new Date(now + TOURNAMENT_DAYS * DAY_MS),
    entryFee: TOURNAMENT_ENTRY_FEE,
  };
  // Уникальный индекс ловит гонку двух одновременных запросов.
  try {
    return await prisma.gameTournament.create({ data });
  } catch {
    const existing = await prisma.gameTournament.findUnique({ where: { index } });
    if (existing) return existing;
    throw new Error("Не удалось открыть турнир");
  }
}

/**
 * Подвести итоги: расставить места и раздать фонд. Идемпотентна.
 */
export async function closeTournament(tournamentId: string) {
  const tournament = await prisma.gameTournament.findUnique({ where: { id: tournamentId } });
  if (!tournament || tournament.closedAt) return;

  const entries = await prisma.gameTournamentEntry.findMany({ where: { tournamentId } });
  const ranked = entries
    .map((entry) => ({ ...entry, result: returnPct(entry.equity, entry.startEquity) }))
    .sort((a, b) => b.result - a.result);

  const enough = ranked.length >= TOURNAMENT_MIN_PLAYERS;

  // Закрываем ПЕРВЫМ действием: даже если начисление упадёт, турнир не будет
  // подводиться заново по кругу.
  await prisma.$transaction([
    prisma.gameTournament.update({ where: { id: tournamentId }, data: { closedAt: new Date() } }),
    ...ranked.map((entry, i) => {
      // Участников мало — возвращаем взнос всем: обмен взносами между двумя
      // людьми это не соревнование.
      const reward = enough ? tournament.prizePool * prizeShare(i + 1) : tournament.entryFee;
      return prisma.gameTournamentEntry.update({
        where: { id: entry.id },
        data: { rank: i + 1, reward },
      });
    }),
    // Начисляем только тем, кому есть что: пустые апдейты ради ровного
    // списка — это лишние запросы в транзакции.
    ...ranked
      .map((entry, i) => ({ entry, reward: enough ? tournament.prizePool * prizeShare(i + 1) : tournament.entryFee }))
      .filter(({ reward }) => reward > 0)
      .map(({ entry, reward }) =>
        prisma.gamePlayer.update({
          where: { id: entry.playerId },
          // Деньги — в очередь на получение, тем же каналом, что призы сезона.
          data: { pendingPayout: { increment: reward } },
        }),
      ),
  ]);

  if (enough && ranked.length > 0) {
    const winner = await prisma.gamePlayer.findUnique({
      where: { id: ranked[0].playerId },
      select: { nickname: true },
    });
    await prisma.gameWorldEvent.create({
      data: {
        playerId: ranked[0].playerId,
        kind: "tournament_won",
        payload: JSON.stringify({
          nickname: winner?.nickname ?? "",
          tournament: tournament.index,
          resultPct: Math.round(ranked[0].result * 10) / 10,
          prize: Math.round(tournament.prizePool * prizeShare(1)),
        }),
      },
    });
  }
}

/** Записаться в текущий турнир. Взнос списывает клиент у себя. */
export async function joinTournament(
  playerId: string,
  equity: number,
  now = Date.now(),
): Promise<TournamentResult<{ entryFee: number; endsAt: number }>> {
  const tournament = await currentTournament(now);
  const existing = await prisma.gameTournamentEntry.findUnique({
    where: { tournamentId_playerId: { tournamentId: tournament.id, playerId } },
  });
  if (existing) return { ok: false, error: "already_joined" };
  if (tournament.endsAt.getTime() <= now) return { ok: false, error: "finished" };

  await prisma.$transaction([
    prisma.gameTournamentEntry.create({
      data: { tournamentId: tournament.id, playerId, startEquity: equity, equity },
    }),
    // Взнос уходит в призовой фонд: он и есть весь приз.
    prisma.gameTournament.update({
      where: { id: tournament.id },
      data: { prizePool: { increment: tournament.entryFee } },
    }),
  ]);

  return { ok: true, value: { entryFee: tournament.entryFee, endsAt: tournament.endsAt.getTime() } };
}

/** Обновить эквити участника — вызывается на синхронизации мира. */
export async function updateTournamentEquity(playerId: string, equity: number, now = Date.now()): Promise<void> {
  const tournament = await currentTournament(now);
  await prisma.gameTournamentEntry.updateMany({
    where: { tournamentId: tournament.id, playerId },
    data: { equity },
  });
}

/** Таблица текущего турнира. */
export async function tournamentStandings(playerId: string, now = Date.now()) {
  const tournament = await currentTournament(now);
  const entries = await prisma.gameTournamentEntry.findMany({
    where: { tournamentId: tournament.id },
    select: {
      playerId: true,
      startEquity: true,
      equity: true,
      player: { select: { nickname: true, rankKey: true, activeStyle: true } },
    },
  });

  const rows = entries
    .map((entry) => ({
      playerId: entry.playerId,
      nickname: entry.player.nickname,
      rankKey: entry.player.rankKey,
      activeStyle: entry.player.activeStyle,
      resultPct: returnPct(entry.equity, entry.startEquity),
    }))
    .sort((a, b) => b.resultPct - a.resultPct);

  return {
    tournament: {
      index: tournament.index,
      startsAt: tournament.startsAt.getTime(),
      endsAt: tournament.endsAt.getTime(),
      entryFee: tournament.entryFee,
      prizePool: tournament.prizePool,
      players: rows.length,
      minPlayers: TOURNAMENT_MIN_PLAYERS,
      prizeShares: TOURNAMENT_PRIZE_SHARES,
    },
    joined: rows.some((row) => row.playerId === playerId),
    rows,
  };
}
