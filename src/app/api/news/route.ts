import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, serverError, sharedCacheHeaders } from "@/lib/api";
import { getNews, asLang } from "@/lib/news";

// Fetching three upstream RSS feeds can take a few seconds on a cold refresh.
export const maxDuration = 60;

// Same feed for everyone (per lang); cache a couple of minutes at the edge.
const CACHE = sharedCacheHeaders(120, 600);

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";
  const lang = asLang(url.searchParams.get("lang"));
  try {
    const data = await getNews({ force, lang });
    // A manual refresh must hit origin, not a stale edge copy.
    return NextResponse.json(data, force ? undefined : { headers: CACHE });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
