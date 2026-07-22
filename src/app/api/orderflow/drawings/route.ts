/**
 * /api/orderflow/drawings — CRUD для рисунков на графике.
 *
 * GET    ?symbol=X&exchange=Y  — список рисунков
 * POST   (body)                — создать рисунок
 * PUT    ?id=X (body)          — обновить рисунок
 * DELETE ?id=X                 — soft-delete
 *
 * Auth: session
 */

import { NextResponse } from "next/server";
import { getAuthUser, unauthorized, badRequest, serverError } from "@/lib/api";
import { createDrawing, getDrawings, updateDrawing, deleteDrawing } from "@/lib/drawings";
import type { DrawingToolType, DrawingPoint } from "@/lib/drawings";

export const maxDuration = 15;

/** GET — список рисунков для symbol + exchange */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol")?.toUpperCase();
  const exchange = url.searchParams.get("exchange") ?? "binance";

  if (!symbol) return badRequest("symbol is required");
  if (!/^[A-Z0-9-]+$/.test(symbol)) return badRequest("invalid symbol");

  try {
    const drawings = await getDrawings({ userId: user.userId, symbol, exchange });
    return NextResponse.json({ drawings });
  } catch (error) {
    console.error("[drawings GET]", error);
    return serverError("Internal server error");
  }
}

/** POST — создать новый рисунок */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  try {
    const body = await req.json();

    if (!body.points || !body.toolType) {
      return badRequest("points and toolType are required");
    }

    const drawing = await createDrawing({
      userId: user.userId,
      symbol: body.symbol,
      exchange: body.exchange ?? "binance",
      toolType: body.toolType as DrawingToolType,
      points: body.points as DrawingPoint[],
      color: body.color,
      lineWidth: body.lineWidth,
      fillColor: body.fillColor,
      label: body.label,
    });

    return NextResponse.json({ drawing }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("invalid")) {
      return badRequest(error.message);
    }
    console.error("[drawings POST]", error);
    return serverError("Internal server error");
  }
}

/** PUT — обновить существующий рисунок */
export async function PUT(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return badRequest("id is required");

  try {
    const body = await req.json();
    const updated = await updateDrawing(id, user.userId, {
      points: body.points as DrawingPoint[] | undefined,
      color: body.color,
      lineWidth: body.lineWidth,
      fillColor: body.fillColor,
      label: body.label,
    });

    if (!updated) return badRequest("Drawing not found");

    return NextResponse.json({ drawing: updated });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("invalid")) {
      return badRequest(error.message);
    }
    console.error("[drawings PUT]", error);
    return serverError("Internal server error");
  }
}

/** DELETE — soft-delete рисунка */
export async function DELETE(req: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return badRequest("id is required");

  try {
    const deleted = await deleteDrawing(id, user.userId);
    if (!deleted) return badRequest("Drawing not found");

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("[drawings DELETE]", error);
    return serverError("Internal server error");
  }
}