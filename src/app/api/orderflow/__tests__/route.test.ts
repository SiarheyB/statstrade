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

describe('Orderflow API Integration Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('GET /orderflow?symbol=BTCUSDT returns 200 with valid params', async () => {
    const req = new Request('http://localhost/api/orderflow?symbol=BTCUSDT&range=1d&tz=UTC');
    const res = await GET(req);

    expect(res.status).toBe(200);
  });

  it('GET /orderflow with empty symbol returns 400', async () => {
    const req = new Request('http://localhost/api/orderflow?symbol=&range=1d&tz=UTC');
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect(res.json()).resolves.toEqual({ error: 'Некорректный символ' });
  });

  it('GET /orderflow with invalid range returns 400', async () => {
    const req = new Request('http://localhost/api/orderflow?symbol=BTCUSDT&range=invalid&tz=UTC');
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect(res.json()).resolves.toEqual({ error: 'Неизвестный таймфрейм' });
  });

  it('GET /orderflow without auth returns 401', async () => {
    const { getAuthUser: getAuthUserMock } = await import('@/lib/api');
    getAuthUserMock.mockResolvedValueOnce(null);

    const req = new Request('http://localhost/api/orderflow?symbol=BTCUSDT&range=1d&tz=UTC');
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });
});