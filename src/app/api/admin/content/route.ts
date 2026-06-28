import { NextResponse } from "next/server";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";
import { refreshNews } from "@/lib/news";
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
