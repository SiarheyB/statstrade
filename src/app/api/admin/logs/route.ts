import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { LogService, type LogFilters, type LogLevel } from "@/lib/log.service";
import { logError } from "@/lib/errorLog";

// Simple in-memory rate limiter for DELETE endpoint
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5; // 5 requests per minute

/**
 * Simple rate limiting middleware
 */
function rateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  if (now > record.resetTime) {
    // Reset window
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return {
      allowed: false,
      retryAfter: Math.ceil((record.resetTime - now) / 1000)
    };
  }

  record.count++;
  return { allowed: true };
}

/**
 * Validate if string is a valid UUID
 */
function isValidUUID(str: string): boolean {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidPattern.test(str);
}

/**
 * GET /api/admin/logs
 * Fetch paginated and filterable logs
 * Query parameters:
 *   - page: page number (default=1)
 *   - limit: items per page (default=20, max=100)
 *   - filters: module, accountId, eventType, level, search, startDate, endDate
 */
export async function GET(req: Request) {
  // Check admin auth
  const result = await requireAdmin();
  if (result instanceof Response) {
    return result;
  }

  // Parse and validate query parameters
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
  // searchParams.get отдаёт null для отсутствующего параметра, а фильтры ждут
  // undefined — иначе «нет фильтра» превратилось бы в «поле равно null».
  const param = (name: string) => url.searchParams.get(name) ?? undefined;
  const date = (name: string) => {
    const raw = param(name);
    return raw ? new Date(raw) : undefined;
  };
  const filters: LogFilters = {
    module: param("module"),
    accountId: param("accountId"),
    eventType: param("eventType"),
    level: param("level") as LogLevel | undefined,
    search: param("search"),
    startDate: date("startDate"),
    endDate: date("endDate"),
  };

  try {
    const result = await LogService.fetchPage(page, limit, filters);
    return NextResponse.json(result);
  } catch (error) {
    logError(`Error fetching logs: ${(error as Error).message}`, { path: "/api/admin/logs" });
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/logs
 * Delete multiple log entries by IDs, or all logs when `{ all: true }`.
 * Request body: { ids: ["123", "456", "..."] } or { all: true }
 */
export async function DELETE(req: Request) {
  // Check admin auth
  const authResult = await requireAdmin();
  if (authResult instanceof Response) {
    return authResult;
  }

  // Rate limiting by IP
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  const rateLimitResult = rateLimit(ip);

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimitResult.retryAfter) } }
    );
  }

  const body = await req.json();

  // Delete all logs
  if (body.all === true) {
    try {
      const result = await LogService.deleteAll();
      return NextResponse.json({ success: true, deletedCount: result.count });
    } catch (error) {
      logError(`Error deleting all logs: ${(error as Error).message}`, { path: "/api/admin/logs" });
      return NextResponse.json({ error: "Failed to delete all logs" }, { status: 500 });
    }
  }

  const ids = (Array.isArray(body.ids) ? body.ids : []) as string[];

  if (!ids.length) {
    return NextResponse.json({ error: "ids array or all:true is required" }, { status: 400 });
  }

  // Validate all IDs are UUIDs
  const invalidIds = ids.filter((id: string) => !isValidUUID(id));
  if (invalidIds.length > 0) {
    return NextResponse.json(
      { error: `Invalid ID format: ${invalidIds.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    await LogService.deleteMany(ids);
    return NextResponse.json({ success: true, deletedIds: ids });
  } catch (error) {
    logError(`Error deleting logs: ${(error as Error).message}`, { path: "/api/admin/logs" });
    return NextResponse.json({ error: "Failed to delete logs" }, { status: 500 });
  }
}