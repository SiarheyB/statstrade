import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { getNews } from "@/lib/news";

// Fetching three upstream RSS feeds can take a few seconds on a cold refresh.
export const maxDuration = 60;

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const force = new URL(req.url).searchParams.get("refresh") === "1";
  try {
    const data = await getNews({ force });
    return NextResponse.json(data);
  } catch (err) {
    return serverError((err as Error).message);
  }
}
