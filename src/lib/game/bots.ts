// Боты-участники мира.
//
// Пустой мир не оживает сам: рейтинг из одного человека, чат, где не с кем
// говорить, фонды, в которые некому вступать. Боты дают миру население с
// первого дня — они торгуют, попадают в рейтинг и разговаривают.
//
// ТАКТ ЛЕНИВЫЙ, как и всё остальное в этой игре: боты «живут» не в фоновом
// процессе, а в момент, когда кто-то открывает мир или чат. Фоновый воркер
// пришлось бы держать живым круглосуточно и поднимать руками после каждого
// падения — а выигрыш нулевой: если в мир никто не смотрит, шевелиться в нём
// незачем.
//
// ЭКВИТИ БОТА двигается по НАСТОЯЩЕМУ рынку, а не случайно: берётся набор
// инструментов его стиля и их дневное изменение. Поэтому в день, когда рынок
// падает, у ботов тоже красно — а нарисованные случайные числа выдали бы их
// сразу же, стоило сравнить с графиком.
//
// РЕЧЬ идёт через языковую модель (см. lib/game/openrouter). Заготовленных
// фраз нет намеренно: набор из двадцати реплик выдаёт бота с третьего
// сообщения вернее, чем молчание. Нет ключа — боты торгуют, но молчат.
import { prisma } from "@/lib/db";
import personasData from "@/data/botPersonas.json";
import { readQuotes, ALL_ASSETS } from "@/lib/game/marketStore";
import { askModel, openRouterConfigured } from "@/lib/game/openrouter";
import { readMessages } from "@/lib/game/social";

export interface BotPersona {
  id: string;
  nickname: string;
  style: string;
  /** Множитель к риску: во сколько раз сильнее рынка ходит его счёт. */
  risk: number;
  /** Мастерство 0..1: доля движений, которые он ловит в свою сторону. */
  skill: number;
  /** Как он разговаривает. Уходит в модель как описание характера. */
  voice: string;
}

export const BOT_PERSONAS = personasData as BotPersona[];

/** Как часто бот шевелится. */
export const BOT_TICK_MS = 5 * 60 * 1000;
/** С какой вероятностью на такте бот пишет в чат. */
export const BOT_CHAT_CHANCE = 0.25;
/** Стартовый капитал бота. */
export const BOT_START_EQUITY = 10_000;
/** Сколько сообщений из чата даём модели как контекст. */
export const CHAT_CONTEXT = 8;

/** Завести ботов, которых ещё нет. Идемпотентна. */
export async function ensureBots(): Promise<number> {
  const existing = await prisma.gamePlayer.findMany({ where: { isBot: true }, select: { persona: true } });
  const have = new Set(existing.map((row) => row.persona));
  let created = 0;
  for (const persona of BOT_PERSONAS) {
    if (have.has(persona.id)) continue;
    try {
      await prisma.gamePlayer.create({
        data: {
          nickname: persona.nickname,
          isBot: true,
          persona: persona.id,
          activeStyle: persona.style,
          equity: BOT_START_EQUITY,
          peakEquity: BOT_START_EQUITY,
          lastBotActAt: new Date(),
          lastSyncAt: new Date(),
        },
      });
      created++;
    } catch {
      // Имя занято живым игроком — такого бота просто не будет.
    }
  }
  return created;
}

function personaOf(id: string | null): BotPersona | undefined {
  return BOT_PERSONAS.find((p) => p.id === id);
}

/** Инструменты, за которыми следит бот этого стиля. */
function watchList(style: string): string[] {
  const byStyle: Record<string, string[]> = {
    scalping: ["CRY_KRYPTON", "CRY_ETHERON", "STK_NEXTEK"],
    day: ["STK_NEXTEK", "STK_QUANTA", "CRY_KRYPTON"],
    swing: ["STK_IRONCORE", "STK_PETROVA", "FX_USDEUR"],
    investing: ["STK_SOLARIS", "STK_GAMEBANK", "BND_MID10Y"],
  };
  const ids = byStyle[style] ?? byStyle.day;
  return ids.filter((id) => ALL_ASSETS.some((asset) => asset.id === id));
}

/**
 * Движение счёта бота за такт.
 *
 * Считается из ДНЕВНОГО изменения его инструментов: рынок падает — падают и
 * боты. Мастерство определяет, какую долю движения он берёт в свою сторону:
 * у сильного счёт растёт даже на падении, у слабого тает и на росте.
 */
export function equityStep(dayChangePct: number, persona: BotPersona, luck: number): number {
  // luck 0..1 — случайность такта: даже мастер иногда встаёт не туда.
  const direction = luck < persona.skill ? 1 : -1;
  // Шаг такта — доля дневного движения: за пять минут счёт не удваивается.
  const share = BOT_TICK_MS / (24 * 60 * 60 * 1000);
  return dayChangePct * persona.risk * direction * share;
}

/** Один такт всех ботов: торговля и, изредка, реплика в чат. */
export async function tickBots(now = Date.now()): Promise<{ moved: number; spoke: number }> {
  const bots = await prisma.gamePlayer.findMany({
    where: { isBot: true, OR: [{ lastBotActAt: null }, { lastBotActAt: { lt: new Date(now - BOT_TICK_MS) } }] },
  });
  if (bots.length === 0) return { moved: 0, spoke: 0 };

  const assetIds = Array.from(new Set(bots.flatMap((bot) => watchList(bot.activeStyle))));
  const quotes = await readQuotes(assetIds, now);

  let moved = 0;
  let spoke = 0;
  for (const bot of bots) {
    const persona = personaOf(bot.persona);
    if (!persona) continue;
    const watched = watchList(bot.activeStyle);
    const changes = watched.map((id) => quotes[id]?.dayChangePct ?? 0);
    const avg = changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
    const luck = Math.random();
    const pct = equityStep(avg, persona, luck);
    const equity = Math.max(100, bot.equity * (1 + pct / 100));

    await prisma.gamePlayer.update({
      where: { id: bot.id },
      data: {
        equity,
        peakEquity: Math.max(bot.peakEquity, equity),
        lastBotActAt: new Date(now),
        lastSyncAt: new Date(now),
      },
    });
    moved++;

    if (openRouterConfigured() && Math.random() < BOT_CHAT_CHANCE) {
      const said = await speak(bot.id, persona, { equity, dayChange: avg, watched, quotes });
      if (said) spoke++;
    }
  }
  return { moved, spoke };
}

/** Реплика бота в общий чат. */
async function speak(
  botId: string,
  persona: BotPersona,
  context: {
    equity: number;
    dayChange: number;
    watched: string[];
    quotes: Record<string, { price: number; dayChangePct: number }>;
  },
): Promise<boolean> {
  const recent = await readMessages("general", CHAT_CONTEXT);
  const market = context.watched
    .map((id) => {
      const asset = ALL_ASSETS.find((a) => a.id === id);
      const quote = context.quotes[id];
      if (!asset || !quote) return null;
      return `${asset.symbol}: ${quote.price} (${quote.dayChangePct >= 0 ? "+" : ""}${quote.dayChangePct.toFixed(2)}%)`;
    })
    .filter(Boolean)
    .join(", ");

  const history = recent
    .slice(-CHAT_CONTEXT)
    .map((message) => `${message.author.nickname}: ${message.text}`)
    .join("\n");

  const text = await askModel([
    {
      role: "system",
      content: [
        `Ты — участник чата трейдеров в браузерной игре. Тебя зовут ${persona.nickname}.`,
        `Характер и манера речи: ${persona.voice}`,
        "Пиши ОДНО короткое сообщение на русском: от трёх слов до двух предложений.",
        "Это живой чат, а не пост: без приветствий, без подписи, без обращения ко всем сразу.",
        "Не упоминай, что ты модель или программа. Не повторяй чужие реплики.",
        "Не давай инвестиционных советов и никого не уговаривай что-то купить.",
        "Иногда просто реагируй на сказанное другими, не начиная новую тему.",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `Твой счёт: ${Math.round(context.equity)} $, рынок сегодня ${context.dayChange >= 0 ? "растёт" : "падает"}.`,
        market ? `Котировки: ${market}.` : "",
        history ? `Последние сообщения:\n${history}` : "В чате пока тихо.",
        "Напиши свою реплику.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ]);

  if (!text) return false;
  // Модель иногда отвечает абзацем — режем: длинная стена текста в живом
  // чате выдаёт бота вернее любого содержания.
  const clean = text.replace(/^["'«]|["'»]$/g, "").split("\n")[0].slice(0, 220).trim();
  if (clean.length < 2) return false;

  await prisma.gameChatMessage.create({ data: { channel: "general", playerId: botId, text: clean } });
  return true;
}
