import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getExchangeGuides, saveExchangeGuide } from "@/lib/exchange-guides";

/**
 * GET /api/admin/exchange-guides
 * Returns all exchange setup guides (merged DB overrides with defaults).
 * Admin-only.
 */
export async function GET() {
  const authResult = await requireAdmin();
  if (authResult instanceof Response) return authResult;

  try {
    const guides = await getExchangeGuides();
    return NextResponse.json({ guides });
  } catch (error) {
    console.error("Error loading exchange guides:", error);
    return NextResponse.json({ error: "Failed to load guides" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/exchange-guides
 * Body: { exchangeId: string, guide: string }
 * Updates the guide for a specific exchange.
 */
export async function PUT(req: Request) {
  const authResult = await requireAdmin();
  if (authResult instanceof Response) return authResult;

  try {
    const body = await req.json();
    const { exchangeId, guide } = body;

    if (!exchangeId || typeof guide !== "string") {
      return NextResponse.json(
        { error: "exchangeId (string) and guide (string) are required" },
        { status: 400 },
      );
    }

    await saveExchangeGuide(exchangeId, guide);
    return NextResponse.json({ success: true, exchangeId });
  } catch (error) {
    console.error("Error saving exchange guide:", error);
    return NextResponse.json({ error: "Failed to save guide" }, { status: 500 });
  }
}