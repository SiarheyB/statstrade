import { tickBots } from "@/lib/game/bots";
import { NextResponse, after } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError, tooManyRequests, readJsonBody } from "@/lib/api";
import { checkGameLimit } from "@/lib/game/limits";
import { getFeatureConfig } from "@/lib/featureConfig";
import { ensurePlayer } from "@/lib/game/world";
import {
  clearsAt,
  lifetimeOf,
  normalizeChannel,
  postMessage,
  purgeExpiredChats,
  readMessages,
  MAX_MESSAGE_LENGTH,
} from "@/lib/game/social";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  empty: "Сообщение пустое",
  too_long: `Слишком длинно, максимум ${MAX_MESSAGE_LENGTH} символов`,
  too_fast: "Слишком часто — подождите пару секунд",
  unknown_channel: "Неизвестный канал",
  not_in_fund: "Вы не состоите в фонде",
  muted: "Вам временно закрыт доступ к чату",
};

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const wait = checkGameLimit(user.userId, "read");
  if (wait) return tooManyRequests(wait);
  try {
    // Такт ботов дёргаем и отсюда: человек ждёт ответа именно в чате, а не на
    // вкладке мира. Не ждём результата — запрос к модели может занять
    // секунду, а лента должна обновиться сразу.
    // after() — а не «просто не ждать»: работа, брошенная через void, живёт
    // ровно до конца запроса, и такт ботов регулярно обрывался на середине
    // (отметка времени уже сдвинута, решение не принято). after() выполняет
    // её ПОСЛЕ ответа и не отменяет вместе с ним.
    after(() => tickBots().catch(() => {}));
    // Очистка просроченных каналов — тем же ленивым способом, что и всё
    // остальное в этой игре: отдельный воркер ради шести таблиц держать
    // незачем, а открытый чат — самый частый момент, когда это уместно.
    after(() => purgeExpiredChats().catch(() => {}));
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const player = await ensurePlayer(user.userId, user.email);
    const raw = new URL(req.url).searchParams.get("channel") ?? "general";
    const channel = normalizeChannel(raw, player.fundId);
    if (!channel) return badRequest(raw === "fund" ? MESSAGES.not_in_fund : MESSAGES.unknown_channel);

    // Срок жизни отдаём вместе с лентой: человек должен знать, что его
    // сообщения не навсегда, ДО того как напишет что-то важное.
    const [messages, clears] = await Promise.all([readMessages(channel), clearsAt(channel)]);
    return NextResponse.json({
      channel: raw,
      messages,
      clearsAt: clears,
      lifetimeMs: lifetimeOf(channel),
    });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

/**
 * Разметка к идее с графиком.
 *
 * Раньше здесь стоял `z.unknown()`: принимался любой JSON любого размера, и
 * тело запроса целиком читалось в память ДО всех проверок — ни пауза между
 * сообщениями, ни мут от этого не спасали. Теперь форма задана точно:
 * пятьдесят фигур, у каждой не больше сотни точек, числа конечные.
 */
const drawingSchema = z
  .array(
    z.object({
      id: z.string().max(60).optional(),
      kind: z.string().max(20),
      points: z
        .array(z.object({ t: z.number().finite(), price: z.number().finite() }))
        .max(100),
    }),
  )
  .max(50);

const schema = z.object({
  channel: z.string().max(20),
  text: z.string().max(1000),
  // Идея с графиком: инструмент, таймфрейм и разметка автора.
  assetId: z.string().max(60).nullable().optional(),
  tf: z.string().max(8).nullable().optional(),
  drawings: drawingSchema.optional(),
});

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const wait = checkGameLimit(user.userId, "chat");
  if (wait) return tooManyRequests(wait);
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });

    const parsed = schema.safeParse(await readJsonBody(req));
    if (!parsed.success) return badRequest("Проверьте данные");
    const player = await ensurePlayer(user.userId, user.email);
    const channel = normalizeChannel(parsed.data.channel, player.fundId);
    if (!channel) return badRequest(parsed.data.channel === "fund" ? MESSAGES.not_in_fund : MESSAGES.unknown_channel);

    const result = await postMessage(player.id, player.nickname, channel, parsed.data.text, {
      assetId: parsed.data.assetId,
      tf: parsed.data.tf,
      drawings: parsed.data.drawings,
    });
    if (!result.ok) return badRequest(MESSAGES[result.error] ?? "Не получилось");
    return NextResponse.json({ ok: true, id: result.value.id });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
