// Общий мир игры: профили, рейтинг и лента событий.
//
// Симуляция рынка остаётся у игрока в браузере — сервер хранит только то,
// что делает мир общим. Отсюда главное ограничение, из которого выросли все
// решения ниже: ПОКАЗАТЕЛИ ПРИСЫЛАЕТ КЛИЕНТ, и подделать их технически
// возможно. Полностью это лечится только переносом симуляции на сервер
// (отдельная большая работа, см. docs/game/CONCEPT.md), а пока защита
// распределена:
//
//   1. Рейтинг считается по достижениям, которые дороже подделать, чем
//      заработать честно: пройденные испытания и престиж, а не «сколько
//      у меня сейчас денег».
//   2. Скачки при синхронизации режутся (clampSnapshot) — счёт не может
//      вырасти в разы за один запрос.
//   3. Деньги между игроками ходят ТОЛЬКО через записи займов и фондов,
//      которые ведёт сервер: соврав про свою эквити, чужие деньги не
//      получишь — можно лишь надуть свой рейтинг.
import { prisma } from "@/lib/db";

export const LEADERBOARD_SIZE = 25;
export const FEED_SIZE = 30;

// Во сколько раз эквити может вырасти между двумя синхронизациями. Клиент
// синхронизируется примерно раз в минуту, а рост в 4 раза за минуту не
// получается даже на самом быстром стиле с максимальным плечом.
export const MAX_EQUITY_GROWTH_PER_SYNC = 4;

export interface PlayerSnapshot {
  fundName: string | null;
  rankKey: string;
  prestige: number;
  level: number;
  equity: number;
  contractsPassed: number;
  bestContractPct: number;
  activeStyle: string;
  gameDay: number;
}

export interface WorldEventPayload {
  [key: string]: string | number | null;
}

/** Ник по умолчанию — из почты, но без домена: почту в мире не показываем. */
export function defaultNickname(email: string, seed: string): string {
  const base = email.split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12) || "trader";
  return `${base}-${seed.slice(-4)}`;
}

export function normalizeNickname(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length < 3 || value.length > 20) return null;
  // Разрешаем буквы (в т.ч. кириллицу), цифры, пробел, дефис и подчёркивание.
  if (!/^[\p{L}\p{N} _-]+$/u.test(value)) return null;
  return value;
}

export async function ensurePlayer(userId: string, email: string) {
  const existing = await prisma.gamePlayer.findUnique({ where: { userId } });
  if (existing) return existing;
  // Гонка двух вкладок на первом заходе: обе видят пустоту и обе создают
  // профиль. Уникальный индекс по userId ловит второго — отдаём ему то, что
  // уже создала первая вкладка, вместо 500-й ошибки.
  try {
    return await prisma.gamePlayer.create({
      data: { userId, nickname: defaultNickname(email, userId) },
    });
  } catch {
    const player = await prisma.gamePlayer.findUnique({ where: { userId } });
    if (player) return player;
    throw new Error("Не удалось создать профиль игрока");
  }
}

/**
 * Режет неправдоподобные значения. Не «ловит читера» — просто не даёт одному
 * запросу переписать рейтинг числом с потолка.
 */
export function clampSnapshot(snapshot: PlayerSnapshot, previousEquity: number): PlayerSnapshot {
  const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);
  const maxEquity = Math.max(previousEquity * MAX_EQUITY_GROWTH_PER_SYNC, 100_000);
  return {
    fundName: snapshot.fundName ? snapshot.fundName.slice(0, 40) : null,
    rankKey: String(snapshot.rankKey).slice(0, 20),
    prestige: Math.max(0, Math.min(100_000, Math.round(finite(snapshot.prestige)))),
    level: Math.max(0, Math.min(10, Math.round(finite(snapshot.level)))),
    equity: Math.max(0, Math.min(maxEquity, finite(snapshot.equity))),
    contractsPassed: Math.max(0, Math.min(50, Math.round(finite(snapshot.contractsPassed)))),
    bestContractPct: Math.max(-100, Math.min(10_000, finite(snapshot.bestContractPct))),
    activeStyle: String(snapshot.activeStyle).slice(0, 20),
    gameDay: Math.max(0, Math.min(1_000_000, Math.round(finite(snapshot.gameDay)))),
  };
}

export async function recordEvent(playerId: string | null, kind: string, payload: WorldEventPayload): Promise<void> {
  await prisma.gameWorldEvent.create({
    data: { playerId, kind, payload: JSON.stringify(payload) },
  });
}

/**
 * Синхронизация профиля. Возвращает игрока и сумму, которую он забирает в
 * игру (проценты по выданным займам и выплаты фонда копятся на сервере,
 * пока игрок не появится).
 */
export async function syncPlayer(userId: string, email: string, snapshot: PlayerSnapshot) {
  const player = await ensurePlayer(userId, email);
  const clean = clampSnapshot(snapshot, player.equity || snapshot.equity);

  // События мира — только на переходах, а не на каждом синке: лента должна
  // читаться, а не заливаться шумом раз в минуту.
  if (clean.contractsPassed > player.contractsPassed) {
    await recordEvent(player.id, "contract_passed", {
      nickname: player.nickname,
      count: clean.contractsPassed,
      resultPct: Math.round(clean.bestContractPct * 10) / 10,
    });
  }
  if (clean.rankKey !== player.rankKey && clean.prestige > player.prestige) {
    await recordEvent(player.id, "rank_up", { nickname: player.nickname, rankKey: clean.rankKey });
  }

  const claimed = player.pendingPayout;
  return {
    player: await prisma.gamePlayer.update({
      where: { id: player.id },
      data: {
        ...clean,
        peakEquity: Math.max(player.peakEquity, clean.equity),
        pendingPayout: 0,
        lastSyncAt: new Date(),
      },
    }),
    claimed,
  };
}

/**
 * Рейтинг. Сортировка НЕ по деньгам: деньги — самое лёгкое, что можно
 * приписать себе, и самое бессмысленное для сравнения (у всех своя партия и
 * свой возраст счёта). Первым идёт число пройденных испытаний, потом
 * престиж, потом лучший результат испытания — всё это требует реально
 * пройденных ступеней.
 */
export async function leaderboard(limit = LEADERBOARD_SIZE) {
  return prisma.gamePlayer.findMany({
    where: { isPublic: true },
    orderBy: [{ contractsPassed: "desc" }, { prestige: "desc" }, { bestContractPct: "desc" }],
    take: limit,
    select: {
      id: true,
      nickname: true,
      fundName: true,
      rankKey: true,
      prestige: true,
      level: true,
      equity: true,
      contractsPassed: true,
      bestContractPct: true,
      activeStyle: true,
      reliability: true,
      lastSyncAt: true,
      fund: { select: { id: true, name: true } },
    },
  });
}

export async function worldFeed(limit = FEED_SIZE) {
  const events = await prisma.gameWorldEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, kind: true, payload: true, createdAt: true },
  });
  return events.map((e) => ({
    id: e.id,
    kind: e.kind,
    createdAt: e.createdAt,
    payload: safeParse(e.payload),
  }));
}

function safeParse(raw: string): WorldEventPayload {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as WorldEventPayload) : {};
  } catch {
    return {};
  }
}
