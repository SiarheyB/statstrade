import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { getFeatureConfig } from "@/lib/featureConfig";
import { generateShareToken } from "@/lib/mentorShare";

function featureDisabled() {
  return NextResponse.json({ error: "Функция отключена" }, { status: 404 });
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    const feature = await getFeatureConfig("mentorMode");
    if (!feature.enabled) return featureDisabled();
    const links = await prisma.shareLink.findMany({
      where: { userId: user.userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ links, maxLinksPerUser: feature.maxLinksPerUser });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

const schema = z.object({ label: z.string().trim().max(80).optional() });

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine — label is optional
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Проверьте данные");

  try {
    const feature = await getFeatureConfig("mentorMode");
    if (!feature.enabled) return featureDisabled();

    const count = await prisma.shareLink.count({ where: { userId: user.userId, revokedAt: null } });
    if (count >= feature.maxLinksPerUser) {
      return badRequest(`Достигнут лимит активных ссылок (${feature.maxLinksPerUser}). Отзовите одну, чтобы создать новую.`);
    }

    const link = await prisma.shareLink.create({
      data: { userId: user.userId, token: generateShareToken(), label: parsed.data.label?.trim() || null },
    });
    return NextResponse.json({ link });
  } catch (err) {
    return serverError((err as Error).message);
  }
}

export async function DELETE(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("Не указан id ссылки");
  try {
    await prisma.shareLink.updateMany({
      where: { id, userId: user.userId },
      data: { revokedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
