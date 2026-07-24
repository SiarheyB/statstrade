/**
 * drawings.ts — CRUD-библиотека для инструментов рисования на графике.
 *
 * Поддерживаемые типы: trend_line, horizontal_line, horizontal_ray, rectangle.
 * Точки хранятся как JSON-строка массива {t, price}.
 */

import { prisma } from "@/lib/db";

// ─── Types ───────────────────────────────────────────────────────────────────

export type DrawingToolType = "trend_line" | "horizontal_line" | "horizontal_ray" | "rectangle";

export const DRAWING_TOOLS: DrawingToolType[] = [
  "trend_line",
  "horizontal_line",
  "horizontal_ray",
  "rectangle",
];

export interface DrawingPoint {
  t: number; // timestamp ms
  price: number;
}

export interface CreateDrawingInput {
  userId: string;
  symbol: string;
  exchange: string;
  toolType: DrawingToolType;
  points: DrawingPoint[];
  color?: string;
  lineWidth?: number;
  fillColor?: string;
  label?: string;
}

export interface UpdateDrawingInput {
  points?: DrawingPoint[];
  color?: string;
  lineWidth?: number;
  fillColor?: string;
  label?: string;
}

export interface DrawingFilter {
  userId: string;
  symbol: string;
  exchange: string;
  includeDeleted?: boolean;
}

export interface DrawingRow {
  id: string;
  userId: string;
  symbol: string;
  exchange: string;
  toolType: DrawingToolType;
  points: string; // JSON string
  color: string;
  lineWidth: number;
  fillColor: string | null;
  label: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// ─── Validation ──────────────────────────────────────────────────────────────

const VALID_TOOLS = new Set<string>(DRAWING_TOOLS);

function validateInput(input: CreateDrawingInput): string | null {
  if (!input.userId) return "userId is required";
  if (!input.symbol) return "symbol is required";
  if (!input.exchange) return "exchange is required";
  if (!VALID_TOOLS.has(input.toolType)) {
    return `invalid toolType, must be one of: ${DRAWING_TOOLS.join(", ")}`;
  }
  if (!Array.isArray(input.points) || input.points.length < 1) {
    return "points must be a non-empty array";
  }
  for (const p of input.points) {
    if (typeof p.t !== "number" || typeof p.price !== "number") {
      return "each point must have t (number) and price (number)";
    }
  }
  if (input.lineWidth !== undefined) {
    const w = Number(input.lineWidth);
    if (!Number.isInteger(w) || w < 1 || w > 10) {
      return "lineWidth must be an integer between 1 and 10";
    }
  }
  return null;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function createDrawing(input: CreateDrawingInput): Promise<DrawingRow> {
  const err = validateInput(input);
  if (err) throw new Error(err);

  const drawing = await prisma.userDrawing.create({
    data: {
      userId: input.userId,
      symbol: input.symbol.toUpperCase(),
      exchange: input.exchange,
      toolType: input.toolType,
      points: JSON.stringify(input.points),
      color: input.color ?? "#e6b800",
      lineWidth: input.lineWidth ?? 2,
      fillColor: input.fillColor ?? null,
      label: input.label ?? null,
    },
  });

  return drawing as DrawingRow;
}

export async function getDrawings(filter: DrawingFilter): Promise<DrawingRow[]> {
  const where: Record<string, unknown> = {
    userId: filter.userId,
    symbol: filter.symbol.toUpperCase(),
    exchange: filter.exchange,
  };

  if (!filter.includeDeleted) {
    where.deletedAt = null;
  }

  const drawings = await prisma.userDrawing.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });

  return drawings as DrawingRow[];
}

export async function getDrawingById(id: string, userId: string): Promise<DrawingRow | null> {
  const drawing = await prisma.userDrawing.findFirst({
    where: { id, userId, deletedAt: null },
  });
  return drawing as DrawingRow | null;
}

export async function updateDrawing(
  id: string,
  userId: string,
  input: UpdateDrawingInput,
): Promise<DrawingRow | null> {
  const existing = await prisma.userDrawing.findFirst({
    where: { id, userId, deletedAt: null },
  });
  if (!existing) return null;

  if (input.lineWidth !== undefined) {
    const w = Number(input.lineWidth);
    if (!Number.isInteger(w) || w < 1 || w > 10) {
      throw new Error("lineWidth must be an integer between 1 and 10");
    }
  }

  const data: Record<string, unknown> = {};
  if (input.points !== undefined) data.points = JSON.stringify(input.points);
  if (input.color !== undefined) data.color = input.color;
  if (input.lineWidth !== undefined) data.lineWidth = input.lineWidth;
  if (input.fillColor !== undefined) data.fillColor = input.fillColor;
  if (input.label !== undefined) data.label = input.label;

  const updated = await prisma.userDrawing.update({
    where: { id },
    data,
  });

  return updated as DrawingRow;
}

export async function deleteDrawing(id: string, userId: string): Promise<boolean> {
  const existing = await prisma.userDrawing.findFirst({
    where: { id, userId, deletedAt: null },
  });
  if (!existing) return false;

  await prisma.userDrawing.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return true;
}

export async function hardDeleteDrawing(id: string): Promise<boolean> {
  try {
    await prisma.userDrawing.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}