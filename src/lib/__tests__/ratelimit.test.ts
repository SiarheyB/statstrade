import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rateLimit, clientIp } from '@/lib/ratelimit';

// Mock Date.now for deterministic tests
describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests below limit', () => {
    const key = 'test-key';
    const limit = 5;
    const windowMs = 60_000;

    // Make requests up to limit
    for (let i = 0; i < limit; i++) {
      const result = rateLimit(key, limit, windowMs);
      expect(result.ok).toBe(true);
      expect(result.retryAfterSec).toBe(0);
    }
  });

  it('denies request when limit exceeded', () => {
    const key = 'test-key-2';
    const limit = 2;
    const windowMs = 60_000;

    // First request allowed
    expect(rateLimit(key, limit, windowMs).ok).toBe(true);
    // Second request allowed
    expect(rateLimit(key, limit, windowMs).ok).toBe(true);
    // Third request denied
    const result = rateLimit(key, limit, windowMs);
    expect(result.ok).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  it('resets after window expires', () => {
    const key = 'test-key-3';
    const limit = 1;
    const windowMs = 10_000; // 10 seconds

    // First request allowed
    expect(rateLimit(key, limit, windowMs).ok).toBe(true);
    // Second request denied (same window)
    expect(rateLimit(key, limit, windowMs).ok).toBe(false);

    // Advance time beyond window
    vi.advanceTimersByTime(windowMs + 1);

    // Should be allowed again (new window)
    expect(rateLimit(key, limit, windowMs).ok).toBe(true);
  });

  it('separates limits by different keys', () => {
    const limit = 1;
    const windowMs = 60_000;

    expect(rateLimit('key-a', limit, windowMs).ok).toBe(true);
    expect(rateLimit('key-b', limit, windowMs).ok).toBe(true);

    // Both keys exhausted independently
    expect(rateLimit('key-a', limit, windowMs).ok).toBe(false);
    expect(rateLimit('key-b', limit, windowMs).ok).toBe(false);
  });

  it('tracks timestamps correctly within window', () => {
    const key = 'test-timestamps';
    const limit = 3;
    const windowMs = 5_000;

    // Make 3 requests at different times
    vi.setSystemTime(1000);
    expect(rateLimit(key, limit, windowMs).ok).toBe(true);

    vi.setSystemTime(2000);
    expect(rateLimit(key, limit, windowMs).ok).toBe(true);

    vi.setSystemTime(3000);
    expect(rateLimit(key, limit, windowMs).ok).toBe(true);

    // 4th request at 3500 should be denied
    vi.setSystemTime(3500);
    expect(rateLimit(key, limit, windowMs).ok).toBe(false);

    // Advance past first request timestamp + window
    vi.setSystemTime(6001); // > 1000 + 5000
    // Oldest (1000) expired, so should allow again
    expect(rateLimit(key, limit, windowMs).ok).toBe(true);
  });

  it('returns retryAfterSec based on oldest request in window', () => {
    const key = 'retry-test';
    const limit = 1;
    const windowMs = 10_000;

    vi.setSystemTime(1000);
    expect(rateLimit(key, limit, windowMs).ok).toBe(true);

    vi.setSystemTime(2000);
    const result = rateLimit(key, limit, windowMs);
    expect(result.ok).toBe(false);
    // oldest timestamp is 1000, windowMs=10000, now=2000
    // retryAfterSec = ceil((10000 - (2000-1000)) / 1000) = ceil(9000/1000) = 9
    expect(result.retryAfterSec).toBe(9);
  });
});

describe('clientIp', () => {
  // Заголовки IP приходят снаружи, и всё, что клиент может написать сам,
  // доверия не заслуживает: по этому значению ключуются лимиты входа,
  // регистрации и 2FA. Наш nginx выставляет x-real-ip и x-forwarded-for
  // ЗАМЕНОЙ и затирает cf-connecting-ip (см. deploy/nginx/nginx.conf).

  it('берёт x-real-ip — его проставляет наш прокси', () => {
    const req = new Request('http://test.com', {
      headers: { 'x-real-ip': '13.14.15.16' },
    });
    expect(clientIp(req)).toBe('13.14.15.16');
  });

  it('из x-forwarded-for берёт ПОСЛЕДНИЙ элемент, а не первый', () => {
    // Первый элемент цепочки — то, что прислал клиент; ближайший к нам
    // (последний) проставлен прокси.
    const req = new Request('http://test.com', {
      headers: { 'x-forwarded-for': '5.6.7.8, 9.10.11.12' },
    });
    expect(clientIp(req)).toBe('9.10.11.12');
  });

  it('игнорирует cf-connecting-ip, пока Cloudflare не объявлен явно', () => {
    // Раньше он читался первым — и одного такого заголовка со случайным
    // значением хватало, чтобы обойти любой лимит.
    const req = new Request('http://test.com', {
      headers: { 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '2.2.2.2' },
    });
    expect(clientIp(req)).toBe('2.2.2.2');
  });

  it('подделанный cf-connecting-ip не подменяет адрес и без других заголовков', () => {
    const req = new Request('http://test.com', {
      headers: { 'cf-connecting-ip': '1.1.1.1' },
    });
    expect(clientIp(req)).toBe('unknown');
  });

  it('читает cf-connecting-ip, когда TRUST_CF_HEADERS=1', () => {
    const prev = process.env.TRUST_CF_HEADERS;
    process.env.TRUST_CF_HEADERS = '1';
    try {
      const req = new Request('http://test.com', {
        headers: { 'cf-connecting-ip': '  1.1.1.1  ', 'x-real-ip': '2.2.2.2' },
      });
      expect(clientIp(req)).toBe('1.1.1.1');
    } finally {
      if (prev === undefined) delete process.env.TRUST_CF_HEADERS;
      else process.env.TRUST_CF_HEADERS = prev;
    }
  });

  it('x-real-ip важнее цепочки x-forwarded-for', () => {
    const req = new Request('http://test.com', {
      headers: { 'x-real-ip': '3.3.3.3', 'x-forwarded-for': '4.4.4.4' },
    });
    expect(clientIp(req)).toBe('3.3.3.3');
  });

  it('обрезает пробелы', () => {
    const req = new Request('http://test.com', {
      headers: { 'x-real-ip': '  192.168.1.1  ' },
    });
    expect(clientIp(req)).toBe('192.168.1.1');
  });

  it('возвращает "unknown", когда заголовков нет', () => {
    const req = new Request('http://test.com', { headers: {} });
    expect(clientIp(req)).toBe('unknown');
  });
});
