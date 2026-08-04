import { NextResponse } from "next/server";
import { getAdminSession, notFound } from "@/lib/admin";
import { serverError } from "@/lib/api";
import { getDeployStatus } from "@/lib/deployStatus";

export async function GET() {
  const session = await getAdminSession();
  if (!session) return notFound();

  try {
    const status = await getDeployStatus();
    return NextResponse.json(status);
  } catch (err) {
    return serverError((err as Error).message);
  }
}
