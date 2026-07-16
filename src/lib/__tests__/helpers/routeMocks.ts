// Shared mocks for API route handlers (integration tests).
//
// Usage in a test file:
//   import { asUser, asGuest, mockPrisma } from "./helpers/routeMocks";
//   import { GET } from "@/app/api/orderflow/route";
//
// Mocks @/lib/api (getAuthUser), @/lib/admin (getAdminSession, recordAudit) and
// @/lib/db (prisma) so route handlers can be exercised without a real DB or
// session cookie. Pure helpers (unauthorized/badRequest/serverError/
// sharedCacheHeaders/notFound) stay real so we can assert on their responses.
import { vi } from "vitest";

// --- Auth control handles (call from tests to set the resolved session) ---
export const mockGetAuthUser = vi.fn();
export const mockGetAdminSession = vi.fn();
export const mockRecordAudit = vi.fn();

export function asUser(over: Record<string, unknown> = {}) {
  mockGetAuthUser.mockResolvedValue({ userId: "u1", email: "user@example.com", ...over });
}
export function asGuest() {
  mockGetAuthUser.mockResolvedValue(null);
}
export function asAdmin(over: Record<string, unknown> = {}) {
  mockGetAdminSession.mockResolvedValue({ userId: "a1", email: "admin@example.com", ...over });
}
export function asNonAdmin() {
  mockGetAdminSession.mockResolvedValue(null);
}

// --- Prisma mock: nested vi.fns with safe defaults; override per test ---
export const mockPrisma = {
  $queryRaw: vi.fn().mockResolvedValue([]),
  $queryRawUnsafe: vi.fn().mockResolvedValue([{ n: 0 }]),
  $executeRaw: vi.fn().mockResolvedValue(0),
  collectorConfig: {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  exchangeAccount: { findMany: vi.fn().mockResolvedValue([]) },
  trade: { findMany: vi.fn().mockResolvedValue([]) },
  fill: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
  },
  riskProfile: { findMany: vi.fn().mockResolvedValue([]) },
  importedTrade: { findMany: vi.fn().mockResolvedValue([]) },
  user: {
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
  },
  tradeAnnotation: { findMany: vi.fn().mockResolvedValue([]) },
  adminAudit: { create: vi.fn().mockResolvedValue({}) },
  errorLog: { create: vi.fn().mockResolvedValue({}) },
};

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getAuthUser: (...a: unknown[]) => mockGetAuthUser(...a),
}));

vi.mock("@/lib/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin")>()),
  getAdminSession: (...a: unknown[]) => mockGetAdminSession(...a),
  recordAudit: (...a: unknown[]) => mockRecordAudit(...a),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
