import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, serverError } from "@/lib/api";
import { getNews, asLang } from "@/lib/news";

// Fetching three upstream RSS feeds can take a few seconds on a cold refresh.
export const maxDuration = 60;

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";
  const lang = asLang(url.searchParams.get("lang"));
  try {
    const data = await getNews({ force, lang });
    return NextResponse.json(data);
  } catch (err) {
    return serverError((err as Error).message);
  }
}
