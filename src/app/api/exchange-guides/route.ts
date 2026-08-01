import { NextResponse } from "next/server";
import { getExchangeGuides } from "@/lib/exchange-guides";
import { logError } from "@/lib/errorLog";

/**
 * GET /api/exchange-guides
 * Returns all exchange setup guides (merged DB overrides with defaults).
 * No auth required — used by the account creation form.
 */
export async function GET() {
  try {
    const guides = await getExchangeGuides();
    return NextResponse.json({ guides });
  } catch (error) {
    logError(`Error loading exchange guides: ${(error as Error).message}`, { path: "/api/exchange-guides" });
    return NextResponse.json({ error: "Failed to load guides" }, { status: 500 });
  }
}