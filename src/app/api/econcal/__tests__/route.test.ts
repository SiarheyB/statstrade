import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '../route';

let mockUser: { id: string } | null = { id: 'test-user' };

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    getAuthUser: vi.fn().mockImplementation(() => Promise.resolve(mockUser)),
    unauthorized: () => ({ status: 401, json: () => Promise.resolve({ error: 'Unauthorized' }) }),
    badRequest: (msg: string) => ({ status: 400, json: () => Promise.resolve({ error: msg }) }),
    serverError: (msg: string) => ({ status: 500, json: () => Promise.resolve({ error: msg }) }),
  };
});

vi.mock('@/lib/econcal', () => ({
  getCalendar: vi.fn().mockResolvedValue([]),
}));

describe('Econcal API Integration Tests', () => {
  afterEach(() => {
    mockUser = { id: 'test-user' };
  });

  it('GET /econcal returns 200 with calendar data', async () => {
    const req = new Request('http://localhost/api/econcal');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.json()).resolves.toEqual(expect.arrayContaining([]));
  });

  it('GET /econcal without auth returns 401', async () => {
    mockUser = null;

    const req = new Request('http://localhost/api/econcal');
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });

    mockUser = { id: 'test-user' };
  });

  it('GET /econcal with refresh=1 returns data', async () => {
    const req = new Request('http://localhost/api/econcal?refresh=1');
    const res = await GET(req);

    expect(res.status).toBe(200);
  });

  it('GET /econcal with error in getCalendar returns 500', async () => {
    const { getCalendar } = await import('@/lib/econcal');
    getCalendar.mockRejectedValueOnce(new Error('Calendar fetch failed'));

    const req = new Request('http://localhost/api/econcal');
    const res = await GET(req);

    expect(res.status).toBe(500);
    expect(res.json()).resolves.toEqual({ error: 'Calendar fetch failed' });
  });
});