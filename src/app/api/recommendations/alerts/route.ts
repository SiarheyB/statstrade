import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError, readJsonBody } from "@/lib/api";
import { recommendationsAccessError } from "@/lib/recommendationsAccess";
import { clampThreshold, DEFAULT_THRESHOLD_ATR } from "@/lib/recommendations/alerts";

// Персональные подписки «сообщить, когда цена подойдёт к уровню».
//
// Подписка привязана не к строке LevelSetup, а к паре символ+цена уровня:
// ночной пересчёт делает таблице сетапов truncate+refill, и подписка по
// внешнему ключу умирала бы каждую ночь вместе с ним.

// Потолок на пользователя. Крон раз в минуту обходит ВСЕ несработавшие
// подписки, и без ограничения один человек мог бы накликать их тысячами.
// Сотня — заведомо больше, чем реально отслеживает живой трейдер.
const MAX_PER_USER = 100;

/** Все подписки пользователя — карточки рисуют по ним состояние колокольчика. */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const denied = await recommendationsAccessError(user);
  if (denied) return denied;

  try {
    const alerts = await prisma.levelAlert.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ alerts });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

type Body = {
  symbol?: unknown;
  levelPrice?: unknown;
  direction?: unknown;
  atr?: unknown;
  thresholdAtr?: unknown;
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Подписаться на уровень (или поменять порог у уже существующей подписки). */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const denied = await recommendationsAccessError(user);
  if (denied) return denied;

  const body = (await readJsonBody(req)) as Body | null;
  const symbol = typeof body?.symbol === "string" ? body.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  const levelPrice = num(body?.levelPrice);
  const atr = num(body?.atr);
  const direction = body?.direction === "short" ? "short" : "long";
  const thresholdAtr = clampThreshold(num(body?.thresholdAtr) ?? DEFAULT_THRESHOLD_ATR);

  if (symbol.length < 5) return badRequest("Некорректный символ");
  // Оба числа должны быть положительными: нулевой ATR сделал бы порог
  // неопределённым, и подписка молча не срабатывала бы никогда.
  if (levelPrice === null || levelPrice <= 0) return badRequest("Некорректная цена уровня");
  if (atr === null || atr <= 0) return badRequest("Некорректный ATR");

  try {
    const existing = await prisma.levelAlert.findUnique({
      where: { userId_symbol_levelPrice: { userId: user.userId, symbol, levelPrice } },
      select: { id: true },
    });
    if (!existing) {
      const count = await prisma.levelAlert.count({ where: { userId: user.userId } });
      if (count >= MAX_PER_USER) {
        return badRequest(`Больше ${MAX_PER_USER} уведомлений одновременно не получится — снимите лишние.`);
      }
    }

    const alert = await prisma.levelAlert.upsert({
      where: { userId_symbol_levelPrice: { userId: user.userId, symbol, levelPrice } },
      create: { userId: user.userId, symbol, levelPrice, direction, atr, thresholdAtr },
      // Смена порога заряжает подписку заново: человек поменял его именно
      // потому, что прошлое срабатывание его не устроило.
      update: { direction, atr, thresholdAtr, triggeredAt: null, triggeredPrice: null },
    });
    return NextResponse.json({ alert });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

/** Отписаться. Принимает либо id, либо пару символ+цена уровня. */
export async function DELETE(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const denied = await recommendationsAccessError(user);
  if (denied) return denied;

  const body = (await readJsonBody(req)) as (Body & { id?: unknown }) | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const symbol = typeof body?.symbol === "string" ? body.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  const levelPrice = num(body?.levelPrice);

  try {
    // userId в условии обязателен и в ветке по id: иначе чужой id стирал бы
    // чужую подписку.
    const where = id
      ? { userId: user.userId, id }
      : symbol && levelPrice !== null
        ? { userId: user.userId, symbol, levelPrice }
        : null;
    if (!where) return badRequest("Нечего удалять");
    const { count } = await prisma.levelAlert.deleteMany({ where });
    return NextResponse.json({ ok: true, removed: count });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
