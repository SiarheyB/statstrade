import { NextResponse } from "next/server";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";
import { z } from "zod";
import { refreshNews, setRetentionDays, MAX_RETENTION_DAYS } from "@/lib/news";
import { refreshCalendar } from "@/lib/econcal";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Ручное обновление глобальных контент-фидов (новости / экономический календарь).
export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  let body: { feed?: string };
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }

  try {
    if (body.feed === "news") {
      const en = await refreshNews("en");
      const ru = await refreshNews("ru");
      const added = [...en, ...ru].reduce((s, r) => s + (r.added ?? 0), 0);
      await recordAudit(session, "content.refresh", { targetType: "content", targetLabel: "news", detail: `+${added}` });
      return NextResponse.json({ ok: true, results: [...en, ...ru] });
    }
    if (body.feed === "econcal") {
      const results = await refreshCalendar();
      const added = results.reduce((s, r) => s + (r.upserted ?? 0), 0);
      await recordAudit(session, "content.refresh", { targetType: "content", targetLabel: "econcal", detail: `+${added}` });
      return NextResponse.json({ ok: true, results });
    }
    return badRequest("Неизвестный фид");
  } catch (err) {
    return serverError((err as Error).message);
  }
}

// Настройки фидов из карточек на /admin/content. Пока это только срок
// хранения новостей: у календаря чистка привязана к границе недели и
// настраивать там нечего.
const settingsSchema = z.object({
  feed: z.literal("news"),
  retentionDays: z.number().int().min(0).max(MAX_RETENTION_DAYS),
});

export async function PATCH(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return badRequest("Проверьте данные");

  try {
    const saved = await setRetentionDays(parsed.data.retentionDays);
    await recordAudit(session, "content.settings", {
      targetType: "content",
      targetLabel: "news",
      detail: `retentionDays=${saved}`,
    });
    return NextResponse.json({ ok: true, retentionDays: saved });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
