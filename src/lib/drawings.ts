/**
 * drawings.ts — CRUD-библиотека для инструментов рисования на графике.
 *
 * Поддерживаемые типы: trend_line, horizontal_line, horizontal_ray, rectangle.
 * Точки хранятся как JSON-строка массива {t, price}.
 */

import { z } from "zod";
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

// Раньше здесь не было НИ ОДНОГО потолка: ни на число точек, ни на длину
// label/color/symbol, ни на количество рисунков у пользователя. Любой
// залогиненный мог неограниченно раздувать БД (SECURITY_AUDIT.md).
//
// Все сообщения об ошибках начинаются с "invalid" намеренно: роуты
// (orderflow/forex) отдают 400 только для таких, иначе валидационная ошибка
// улетала пользователю как 500.

/** Сколько точек реально использует каждый инструмент — см. DrawingOverlay:
 *  горизонталь/луч рисуются от одной точки, линия и прямоугольник от двух.
 *  Лишние точки рендер просто игнорировал, а в БД они хранились. */
const POINTS_PER_TOOL: Record<DrawingToolType, number> = {
  trend_line: 2,
  horizontal_line: 1,
  horizontal_ray: 1,
  rectangle: 2,
};

/** Потолок на пользователя — чтобы скриптом нельзя было залить миллион строк. */
export const MAX_DRAWINGS_PER_USER = 500;

/** Мягко удалённые рисунки тоже занимают место: чистим свои старше 30 дней. */
const SOFT_DELETE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_LABEL_LEN = 100;
const MAX_SYMBOL_LEN = 32;
const MAX_EXCHANGE_LEN = 32;

// t в миллисекундах: от нуля до 2100-01-01 — шире реального графика, но не
// даёт записать 1e308 или NaN.
const MAX_TIMESTAMP_MS = 4_102_444_800_000;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// symbol проверяем уже в верхнем регистре: "BTCUSDT", "EUR/USD".
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9/._-]*$/;
const EXCHANGE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const finiteNumber = z.number().refine((v) => Number.isFinite(v), "must be a finite number");

const pointSchema = z.object({
  t: finiteNumber.refine(
    (v) => Number.isInteger(v) && v >= 0 && v <= MAX_TIMESTAMP_MS,
    "t must be a timestamp in ms",
  ),
  price: finiteNumber,
});

const colorSchema = z.string().regex(HEX_COLOR, "must be a hex color like #e6b800");

const createSchema = z.object({
  userId: z.string().min(1),
  symbol: z.string().min(1).max(MAX_SYMBOL_LEN).transform((s) => s.toUpperCase()).refine(
    (s) => SYMBOL_RE.test(s),
    "symbol has invalid characters",
  ),
  exchange: z.string().min(1).max(MAX_EXCHANGE_LEN).regex(EXCHANGE_RE, "exchange has invalid characters"),
  toolType: z.enum(DRAWING_TOOLS as [DrawingToolType, ...DrawingToolType[]]),
  points: z.array(pointSchema).min(1).max(2),
  color: colorSchema.optional(),
  lineWidth: z.number().int().min(1).max(10).optional(),
  fillColor: colorSchema.optional(),
  label: z.string().max(MAX_LABEL_LEN).optional(),
});

const updateSchema = z.object({
  points: z.array(pointSchema).min(1).max(2).optional(),
  color: colorSchema.optional(),
  lineWidth: z.number().int().min(1).max(10).optional(),
  fillColor: colorSchema.optional(),
  label: z.string().max(MAX_LABEL_LEN).optional(),
});

/** Первая ошибка zod в виде "invalid <путь>: <сообщение>". */
function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  const path = issue.path.join(".");
  return `invalid ${path || "input"}: ${issue.message}`;
}

function checkPointCount(toolType: DrawingToolType, points: DrawingPoint[]): void {
  const need = POINTS_PER_TOOL[toolType];
  if (points.length !== need) {
    throw new Error(`invalid points: ${toolType} requires exactly ${need} point(s)`);
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function createDrawing(input: CreateDrawingInput): Promise<DrawingRow> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new Error(firstIssue(parsed.error));
  const data = parsed.data;
  checkPointCount(data.toolType, data.points);

  const active = await prisma.userDrawing.count({
    where: { userId: data.userId, deletedAt: null },
  });
  if (active >= MAX_DRAWINGS_PER_USER) {
    throw new Error(`invalid request: drawing limit reached (${MAX_DRAWINGS_PER_USER})`);
  }

  const drawing = await prisma.userDrawing.create({
    data: {
      userId: data.userId,
      symbol: data.symbol,
      exchange: data.exchange,
      toolType: data.toolType,
      points: JSON.stringify(data.points),
      color: data.color ?? "#e6b800",
      lineWidth: data.lineWidth ?? 2,
      fillColor: data.fillColor ?? null,
      label: data.label ?? null,
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
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw new Error(firstIssue(parsed.error));
  const patch = parsed.data;

  const existing = await prisma.userDrawing.findFirst({
    where: { id, userId, deletedAt: null },
  });
  if (!existing) return null;

  // Число точек зависит от инструмента, поэтому проверяем после загрузки строки.
  if (patch.points !== undefined) {
    checkPointCount(existing.toolType as DrawingToolType, patch.points);
  }

  const data: Record<string, unknown> = {};
  if (patch.points !== undefined) data.points = JSON.stringify(patch.points);
  if (patch.color !== undefined) data.color = patch.color;
  if (patch.lineWidth !== undefined) data.lineWidth = patch.lineWidth;
  if (patch.fillColor !== undefined) data.fillColor = patch.fillColor;
  if (patch.label !== undefined) data.label = patch.label;

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

  // Мягко удалённые строки иначе копятся вечно: попутно выносим свои старые.
  try {
    await prisma.userDrawing.deleteMany({
      where: { userId, deletedAt: { lt: new Date(Date.now() - SOFT_DELETE_RETENTION_MS) } },
    });
  } catch {
    // уборка не должна ломать само удаление
  }

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