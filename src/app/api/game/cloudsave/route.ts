import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, unauthorized, badRequest, serverError, tooManyRequests, readJsonBody } from "@/lib/api";
import { checkGameLimit } from "@/lib/game/limits";
import { getFeatureConfig } from "@/lib/featureConfig";
import { getCloudSave, putCloudSave, MAX_PAYLOAD_BYTES } from "@/lib/game/cloudSave";

export const dynamic = "force-dynamic";

/** Забрать облачную копию сохранения — читается при заходе на новом устройстве. */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const wait = checkGameLimit(user.userId, "sync");
  if (wait) return tooManyRequests(wait);
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
    const save = await getCloudSave(user.userId);
    return NextResponse.json({ save });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const schema = z.object({
  gameElapsedMs: z.number().finite().min(0),
  // Само тело — непрозрачная для сервера JSON-строка (клиент сам решает
  // форму), но потолок длины ставим ДО чтения в БД, а не после — иначе
  // проверка в putCloudSave() уже приняла бы весь пейлоад в память.
  payload: z.string().max(MAX_PAYLOAD_BYTES),
});

/** Сохранить облачную копию. Тот же ритм, что у автосейва — раз в минуту. */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const wait = checkGameLimit(user.userId, "sync");
  if (wait) return tooManyRequests(wait);
  try {
    const feature = await getFeatureConfig("game");
    if (!feature.enabled) return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
    const parsed = schema.safeParse(await readJsonBody(req));
    if (!parsed.success) return badRequest("Проверьте данные");
    const result = await putCloudSave(user.userId, parsed.data.gameElapsedMs, parsed.data.payload);
    if (!result.ok) return badRequest("Сохранение слишком большое");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
