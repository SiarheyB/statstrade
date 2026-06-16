import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { syncChunk } from "@/lib/sync";

// One chunk of a chunked background import. The client calls this repeatedly
// (while status === "syncing") to walk the scan and render a progress bar.
// Kept under the Hobby plan's 60s function limit.
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const account = await prisma.exchangeAccount.findFirst({
    where: { id, userId: user.userId },
  });
  if (!account) return badRequest("Аккаунт не найден");

  let rescan = false;
  try {
    const body = await req.json();
    rescan = !!body?.rescan;
  } catch {
    // no body is fine
  }

  try {
    const progress = await syncChunk(id, { rescan });
    return NextResponse.json(progress);
  } catch (err) {
    return serverError((err as Error).message);
  }
}
