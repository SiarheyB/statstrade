import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET } from '../collector/route';

let mockSession: { id: string } | null = { id: 'test-admin' };

vi.mock('@/lib/admin', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin')>('@/lib/admin');
  return {
    ...actual,
    getAdminSession: vi.fn().mockImplementation(() => Promise.resolve(mockSession)),
    notFound: () => ({ status: 404, json: () => Promise.resolve({ error: 'Not found' }) }),
  };
});

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
}));

describe('Admin Collector API Integration Tests', () => {
  afterEach(() => {
    mockSession = { id: 'test-admin' };
  });

  it('GET /admin/collector returns 200 with admin session', async () => {
    const req = new Request('http://localhost/api/admin/collector');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.json()).resolves.toHaveProperty('feeds');
  });

  it('GET /admin/collector without admin session returns 404', async () => {
    mockSession = null;

    const req = new Request('http://localhost/api/admin/collector');
    const res = await GET(req);

    expect(res.status).toBe(404);
    expect(res.json()).resolves.toEqual({ error: 'Not found' });

    mockSession = { id: 'test-admin' };
  });
});