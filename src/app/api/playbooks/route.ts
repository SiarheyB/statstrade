import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";

function featureDisabled() {
  return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const feature = await getFeatureConfig("playbooks");
    if (!feature.enabled) return featureDisabled();
    const playbooks = await prisma.playbook.findMany({
      where: { userId: user.userId },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ playbooks, maxPerUser: feature.maxPerUser });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const schema = z.object({
  name: z.string().trim().min(1).max(60),
  rules: z.string().max(5000),
});

export async function PUT(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Некорректный запрос");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Проверьте данные", parsed.error.flatten().fieldErrors);
  const { name, rules } = parsed.data;

  try {
    const feature = await getFeatureConfig("playbooks");
    if (!feature.enabled) return featureDisabled();

    const existing = await prisma.playbook.findUnique({
      where: { userId_name: { userId: user.userId, name } },
      select: { id: true },
    });
    if (!existing) {
      const count = await prisma.playbook.count({ where: { userId: user.userId } });
      if (count >= feature.maxPerUser) {
        return badRequest(`Достигнут лимит плейбуков (${feature.maxPerUser}). Удалите один, чтобы добавить новый.`);
      }
    }

    const playbook = await prisma.playbook.upsert({
      where: { userId_name: { userId: user.userId, name } },
      create: { userId: user.userId, name, rules },
      update: { rules },
    });
    return NextResponse.json({ playbook });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

export async function DELETE(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const name = new URL(req.url).searchParams.get("name");
  if (!name) return badRequest("Не указано имя плейбука");
  try {
    await prisma.playbook.deleteMany({ where: { userId: user.userId, name } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
