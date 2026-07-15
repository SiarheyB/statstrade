import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '../route';

let mockUser: { id: string } = { id: 'test-user' };

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

vi.mock('@/lib/liqmap', () => ({
  computeLiqMap: vi.fn().mockResolvedValue({ heatmap: [] }), // Return non-null value to get 200
}));

describe('Liqmap API Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /liqmap returns 200 with heatmap data', async () => {
    const req = new Request('http://localhost/api/liqmap?exchange=all&symbol=BTCUSDT&tf=7d');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json(); // await the resolved JSON
    expect(data).toHaveProperty('heatmap');
  });

  it('GET /liqmap without auth returns 401', async () => {
    mockUser = null as any;

    const req = new Request('http://localhost/api/liqmap?exchange=all&symbol=BTCUSDT&tf=7d');
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });

    mockUser = { id: 'test-user' };
  });

  it('GET /liqmap with invalid exchange returns 400', async () => {
    const req = new Request('http://localhost/api/liqmap?exchange=invalid&symbol=BTCUSDT&tf=7d');
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect(res.json()).resolves.toEqual({ error: 'Неизвестная биржа' });
  });
});