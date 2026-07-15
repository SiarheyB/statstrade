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
  it('gets IP from cf-connecting-ip header', () => {
    const req = new Request('http://test.com', {
      headers: { 'cf-connecting-ip': '1.2.3.4' },
    });
    expect(clientIp(req)).toBe('1.2.3.4');
  });

  it('gets IP from X-Forwarded-For', () => {
    const req = new Request('http://test.com', {
      headers: { 'x-forwarded-for': '5.6.7.8, 9.10.11.12' },
    });
    expect(clientIp(req)).toBe('5.6.7.8');
  });

  it('falls back to x-real-ip', () => {
    const req = new Request('http://test.com', {
      headers: { 'x-real-ip': '13.14.15.16' },
    });
    expect(clientIp(req)).toBe('13.14.15.16');
  });

  it('returns "unknown" for missing headers', () => {
    const req = new Request('http://test.com', {
      headers: {},
    });
    expect(clientIp(req)).toBe('unknown');
  });

  it('trims whitespace from headers', () => {
    const req = new Request('http://test.com', {
      headers: { 'cf-connecting-ip': '  192.168.1.1  ' },
    });
    expect(clientIp(req)).toBe('192.168.1.1');
  });

  it('prefers cf-connecting-ip over x-forwarded-for', () => {
    const req = new Request('http://test.com', {
      headers: {
        'cf-connecting-ip': '1.1.1.1',
        'x-forwarded-for': '2.2.2.2',
      },
    });
    expect(clientIp(req)).toBe('1.1.1.1');
  });
});