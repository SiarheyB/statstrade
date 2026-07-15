import { describe, it, expect, vi } from 'vitest';
import { getAuthUser, unauthorized, badRequest, serverError, tooManyRequests, sharedCacheHeaders } from '@/lib/api';

// Mock next/headers cookies() for getAuthUser
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: () => undefined,
  }),
}));

describe('api helper functions', () => {
  it('getAuthUser returns null when no session cookie', async () => {
    const result = await getAuthUser();
    expect(result).toBeNull();
  });

  it('unauthorized returns proper response', () => {
    const response = unauthorized();
    expect(response.status).toBe(401);
  });

  it('badRequest returns proper response with message', async () => {
    const response = badRequest('test error');
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain('test error');
  });

  it('serverError returns proper response', () => {
    const response = serverError('internal server error');
    expect(response.status).toBe(500);
  });

  it('tooManyRequests returns proper response with retry header', () => {
    const response = tooManyRequests(60);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
  });

  it('sharedCacheHeaders returns correct headers', () => {
    const headers = sharedCacheHeaders(3600, 300);
    expect(headers).toEqual({
      'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=300',
    });
  });
});