import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // сборка весит ~160 КБ; больше — явно не тот файл
const LABEL_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,19}$/;

// Загрузить новую сборку советника. Прежняя заменяется той же строкой
// (id = "current"), то есть удаляется автоматически.
export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const file = form.get("file");
  const label = String(form.get("label") ?? "").trim();
  if (!(file instanceof File)) return badRequest("Выберите файл");
  if (!file.name.toLowerCase().endsWith(".ex5")) return badRequest("Нужен файл .ex5");
  if (!LABEL_RE.test(label)) return badRequest("Укажите версию, например 2.11");
  if (file.size === 0) return badRequest("Файл пустой");
  if (file.size > MAX_BYTES) return badRequest("Файл слишком большой (максимум 5 МБ)");

  try {
    const data = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(data).digest("hex");
    const fields = { data, size: data.length, sha256, label, uploadedAt: new Date(), uploadedBy: session.email };
    await prisma.advisorFile.upsert({ where: { id: "current" }, create: { id: "current", ...fields }, update: fields });
    await recordAudit(session, "advisor.upload", {
      targetType: "AdvisorFile",
      targetId: "current",
      detail: `v${label}, ${data.length} B, sha256=${sha256.slice(0, 12)}`,
    });
    return NextResponse.json({ ok: true, label, size: data.length });
  } catch (e) {
    return serverError((e as Error).message);
  }
}

// Убрать загруженную сборку: пользователям снова отдаётся файл из образа.
export async function DELETE() {
  const session = await getAdminSession();
  if (!session) return notFound();
  try {
    await prisma.advisorFile.deleteMany({ where: { id: "current" } });
    await recordAudit(session, "advisor.reset", { targetType: "AdvisorFile", targetId: "current" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError((e as Error).message);
  }
}
