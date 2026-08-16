import { NextResponse } from "next/server";
import { getAuthUser, serverError, sharedCacheHeaders } from "@/lib/api";
import { getNews, asLang } from "@/lib/news";

// Fetching three upstream RSS feeds can take a few seconds on a cold refresh.
export const maxDuration = 60;

// Same feed for everyone (per lang); cache a couple of minutes at the edge.
const CACHE = sharedCacheHeaders(120, 600);

// Лента публичная: её же читает главная и страница /news для гостя. Обход
// фидов (?refresh=1) остаётся только авторизованным — это единственная тяжёлая
// операция здесь, и анониму она не нужна: фоновое обновление всё равно идёт.
export async function GET(req: Request) {
  const user = await getAuthUser();

  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1" && !!user;
  const lang = asLang(url.searchParams.get("lang"));
  try {
    const data = await getNews({ force, lang });
    // A manual refresh must hit origin, not a stale edge copy.
    return NextResponse.json(data, force ? undefined : { headers: CACHE });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
