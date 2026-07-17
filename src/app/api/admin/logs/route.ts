import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { LogService } from "@/lib/log.service";

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
  const result = await requireAdmin();
  if (result instanceof Response) {
    return result;
  }

  const body = await req.json();
  const ids = Array.isArray(body.ids) ? body.ids : [];

  if (!ids.length) {
    return NextResponse.json({ error: "ids array is required" }, { status: 400 });
  }

  try {
    await LogService.deleteMany(ids);
    return NextResponse.json({ success: true, deletedIds: ids });
  } catch (error) {
    console.error("Error deleting logs:", error);
    return NextResponse.json({ error: "Failed to delete logs" }, { status: 500 });
  }
}