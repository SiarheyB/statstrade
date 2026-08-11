import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, serverError, sharedCacheHeaders } from "@/lib/api";
import { getCalendar } from "@/lib/econcal";

// A cold refresh pulls three weekly JSON feeds and upserts them.
export const maxDuration = 60;

// Same calendar for everyone (per filter params in the URL); cache 5 min.
const CACHE = sharedCacheHeaders(300, 1800);

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const force = url.searchParams.get("refresh") === "1";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const currencies = url.searchParams.get("currencies");
  const impacts = url.searchParams.get("impacts");
  const category = url.searchParams.get("category");

  try {
    const data = await getCalendar({
      force,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      currencies: currencies ? currencies.split(",").filter(Boolean) : undefined,
      impacts: impacts ? impacts.split(",").filter(Boolean) : undefined,
      category: category && category !== "all" ? category : undefined,
    });
    // A manual refresh must hit origin, not a stale edge copy.
    return NextResponse.json(data, force ? undefined : { headers: CACHE });
  } catch (err) {
    return serverError((err as Error).message);
  }
}
