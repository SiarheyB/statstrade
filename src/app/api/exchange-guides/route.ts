import { NextResponse } from "next/server";
import { getExchangeGuides } from "@/lib/exchange-guides";

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
    console.error("Error loading exchange guides:", error);
    return NextResponse.json({ error: "Failed to load guides" }, { status: 500 });
  }
}