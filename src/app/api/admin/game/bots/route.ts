import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { BOT_PERSONAS, BOT_START_EQUITY, DEFAULT_AI_PCT } from "@/lib/game/bots";
import { symbolOf } from "@/lib/game/assetNames";
import { positionPnlPct } from "@/lib/game/botBrain";
import { readQuotes } from "@/lib/game/marketStore";

export const dynamic = "force-dynamic";

/**
 * Боты глазами админа: кто чем торгует, что думает и на какие настройки
 * настроен.
 *
 * Раньше боты были захардкожены справочником характеров: чтобы завести
 * седьмого или сделать одного из них умнее, требовался передеплой. Мир,
 * населённый неизменяемым набором из шести человек, стареет быстро — поэтому
 * ботов теперь заводят и настраивают отсюда.
 */

const STYLES = ["scalping", "day", "swing", "investing"] as const;

const createSchema = z.object({
  nickname: z.string().min(2).max(24),
  style: z.enum(STYLES).default("day"),
  /** Интеллект: доля решений, которые оказываются верными. */
  skillPct: z.number().min(0).max(100).default(55),
  /** Стремление: какую долю счёта бот готов поставить в одну идею. */
  riskPct: z.number().min(5).max(400).default(100),
  /** Насколько глубоко думает моделью. */
  aiPct: z.number().min(0).max(100).default(DEFAULT_AI_PCT),
  startEquity: z.number().min(100).max(100_000_000).default(BOT_START_EQUITY),
  voice: z.string().max(400).optional(),
});

const updateSchema = z.object({
  id: z.string().min(1).max(60),
  style: z.enum(STYLES).optional(),
  skillPct: z.number().min(0).max(100).optional(),
  riskPct: z.number().min(5).max(400).optional(),
  aiPct: z.number().min(0).max(100).optional(),
  voice: z.string().max(400).optional(),
  active: z.boolean().optional(),
  /** Поставить счёт заново: деньги в кэш, позиции закрыть. */
  resetEquity: z.number().min(100).max(100_000_000).optional(),
});

export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const bots = await prisma.gamePlayer.findMany({
      where: { isBot: true },
      orderBy: { equity: "desc" },
      select: {
        id: true,
        nickname: true,
        persona: true,
        activeStyle: true,
        equity: true,
        peakEquity: true,
        botSkill: true,
        botRisk: true,
        botAiPct: true,
        botVoice: true,
        botCash: true,
        botActive: true,
        botPlan: true,
        lastBotActAt: true,
        botPositions: {
          select: { id: true, assetId: true, side: true, qty: true, entryPrice: true, openedAt: true, reason: true },
        },
      },
    });

    // Позиции показываем с текущим результатом: список входов без ответа на
    // вопрос «и что, он в плюсе?» админу ничего не говорит.
    const assetIds = Array.from(new Set(bots.flatMap((bot) => bot.botPositions.map((p) => p.assetId))));
    const quotes = assetIds.length > 0 ? await readQuotes(assetIds) : {};

    return NextResponse.json({
      // У ботов из справочника настройки могут быть ещё не скопированы в
      // строку: показываем то, по чему они на самом деле ходят, — иначе
      // админ правил бы ползунок, который ничего не описывает.
      bots: bots.map((bot) => {
        const persona = BOT_PERSONAS.find((item) => item.id === bot.persona);
        return {
        id: bot.id,
        nickname: bot.nickname,
        persona: bot.persona,
        style: bot.activeStyle,
        equity: bot.equity,
        peakEquity: bot.peakEquity,
        cash: bot.botCash ?? bot.equity,
        skillPct: Math.round((bot.botSkill ?? persona?.skill ?? 0.55) * 100),
        riskPct: Math.round((bot.botRisk ?? persona?.risk ?? 1) * 100),
        aiPct: bot.botAiPct ?? DEFAULT_AI_PCT,
        voice: bot.botVoice,
        active: bot.botActive,
        plan: bot.botPlan,
        lastActAt: bot.lastBotActAt?.getTime() ?? null,
        positions: bot.botPositions.map((position) => {
          const price = quotes[position.assetId]?.price ?? position.entryPrice;
          return {
            id: position.id,
            symbol: symbolOf(position.assetId),
            side: position.side,
            qty: position.qty,
            entryPrice: position.entryPrice,
            price,
            pnlPct: positionPnlPct(
              {
                id: position.id,
                assetId: position.assetId,
                side: position.side === "short" ? "short" : "long",
                qty: position.qty,
                entryPrice: position.entryPrice,
                openedAt: position.openedAt.getTime(),
              },
              price,
            ),
            reason: position.reason,
            openedAt: position.openedAt.getTime(),
          };
        }),
        };
      }),
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest("Проверьте поля бота");
    const data = parsed.data;

    const taken = await prisma.gamePlayer.findUnique({ where: { nickname: data.nickname } });
    if (taken) return badRequest("Такое имя в мире уже занято");

    const bot = await prisma.gamePlayer.create({
      data: {
        nickname: data.nickname,
        isBot: true,
        // persona остаётся пустой: характер такого бота живёт в его
        // собственных полях, а не в справочнике.
        activeStyle: data.style,
        equity: data.startEquity,
        peakEquity: data.startEquity,
        botCash: data.startEquity,
        botSkill: data.skillPct / 100,
        botRisk: data.riskPct / 100,
        botAiPct: data.aiPct,
        botVoice: data.voice?.trim() || null,
        lastBotActAt: new Date(),
      },
      select: { id: true, nickname: true },
    });
    await recordAudit(session, "game.bot.create", { targetType: "gameBot", targetId: bot.id, targetLabel: bot.nickname });
    return NextResponse.json({ ok: true, id: bot.id });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

export async function PATCH(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest("Проверьте поля бота");
    const { id, ...patch } = parsed.data;

    const bot = await prisma.gamePlayer.findFirst({ where: { id, isBot: true }, select: { id: true } });
    if (!bot) return notFound();

    if (patch.resetEquity !== undefined) {
      // Счёт «с нуля»: позиции закрываются, деньги встают в кэш. Иначе новая
      // сумма спорила бы со старыми позициями и эквити прыгнуло бы вдвое.
      await prisma.gameBotPosition.deleteMany({ where: { botId: id } });
    }

    await prisma.gamePlayer.update({
      where: { id },
      data: {
        ...(patch.style !== undefined ? { activeStyle: patch.style } : {}),
        ...(patch.skillPct !== undefined ? { botSkill: patch.skillPct / 100 } : {}),
        ...(patch.riskPct !== undefined ? { botRisk: patch.riskPct / 100 } : {}),
        ...(patch.aiPct !== undefined ? { botAiPct: patch.aiPct } : {}),
        ...(patch.voice !== undefined ? { botVoice: patch.voice.trim() || null } : {}),
        ...(patch.active !== undefined ? { botActive: patch.active } : {}),
        ...(patch.resetEquity !== undefined
          ? { equity: patch.resetEquity, peakEquity: patch.resetEquity, botCash: patch.resetEquity }
          : {}),
      },
    });
    await recordAudit(session, "game.bot.update", { targetType: "gameBot", targetId: id, detail: JSON.stringify(patch) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

export async function DELETE(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return badRequest("Не указан бот");
    const bot = await prisma.gamePlayer.findFirst({ where: { id, isBot: true }, select: { id: true, nickname: true } });
    if (!bot) return notFound();
    // Сообщения бота остаются: удалить их значит вырезать куски чужих
    // разговоров, где на него отвечали.
    await prisma.gamePlayer.delete({ where: { id } });
    await recordAudit(session, "game.bot.delete", { targetType: "gameBot", targetId: id, targetLabel: bot.nickname });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
