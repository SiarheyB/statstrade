import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { LogService } from "@/lib/log.service";

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
  const session = result as any;

  // Parse and validate query parameters
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
  const filters: any = {
    module: url.searchParams.get("module"),
    accountId: url.searchParams.get("accountId"),
    eventType: url.searchParams.get("eventType"),
    level: url.searchParams.get("level") as "info" | "warn" | "error" | undefined,
    search: url.searchParams.get("search"),
    startDate: url.searchParams.get("startDate") ? new Date(url.searchParams.get("startDate") ?? "") : undefined,
    endDate: url.searchParams.get("endDate") ? new Date(url.searchParams.get("endDate") ?? "") : undefined,
  };

  try {
    const result = await LogService.fetchPage(page, limit, filters);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching logs:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/logs
 * Delete multiple log entries by IDs
 * Request body: { ids: ["123", "456", "..."] }
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
  const ids = (Array.isArray(body.ids) ? body.ids : []) as string[];

  if (!ids.length) {
    return NextResponse.json({ error: "ids array is required" }, { status: 400 });
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
    console.error("Error deleting logs:", error);
    return NextResponse.json({ error: "Failed to delete logs" }, { status: 500 });
  }
}