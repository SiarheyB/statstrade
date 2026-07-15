import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock global fetch for turnstile verification
const fetchMock = vi.fn();

// Mock the VERIFY_URL constant and fetch globally
vi.stubGlobal('fetch', fetchMock);

import { turnstileEnabled, verifyTurnstile } from '@/lib/turnstile';

describe('turnstile module', () => {
  const OLD_ENV = process.env.TURNSTILE_SECRET;

  beforeEach(() => {
    fetchMock.mockReset();
    // Clear the secret by default for most tests
    delete process.env.TURNSTILE_SECRET;
  });

  afterEach(() => {
    if (OLD_ENV === undefined) {
      delete process.env.TURNSTILE_SECRET;
    } else {
      process.env.TURNSTILE_SECRET = OLD_ENV;
    }
  });

  describe('turnstileEnabled', () => {
    it('returns false when TURNSTILE_SECRET is not set', () => {
      delete process.env.TURNSTILE_SECRET;
      expect(turnstileEnabled()).toBe(false);
    });

    it('returns true when TURNSTILE_SECRET is set', () => {
      process.env.TURNSTILE_SECRET = 'test-secret';
      expect(turnstileEnabled()).toBe(true);
    });
  });

  describe('verifyTurnstile', () => {
    it('returns true when turnstile is not configured (no secret)', async () => {
      delete process.env.TURNSTILE_SECRET;
      const result = await verifyTurnstile('some-token', '127.0.0.1');
      expect(result).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns false when token is missing but secret is set', async () => {
      process.env.TURNSTILE_SECRET = 'test-secret';
      const result = await verifyTurnstile(undefined, '127.0.0.1');
      expect(result).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns true when verification succeeds', async () => {
      process.env.TURNSTILE_SECRET = 'test-secret';
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
      const result = await verifyTurnstile('valid-token', '127.0.0.1');
      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // Verify the correct URL was called
      const callUrl = fetchMock.mock.calls[0][0];
      expect(callUrl).toContain('challenges.cloudflare.com/turnstile/v0/siteverify');
    });

    it('returns false when verification fails', async () => {
      process.env.TURNSTILE_SECRET = 'test-secret';
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: false }),
      });
      const result = await verifyTurnstile('invalid-token', '127.0.0.1');
      expect(result).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns false when HTTP response is not ok', async () => {
      process.env.TURNSTILE_SECRET = 'test-secret';
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
      });
      const result = await verifyTurnstile('some-token', '127.0.0.1');
      expect(result).toBe(false);
    });

    it('returns false when fetch throws an error', async () => {
      process.env.TURNSTILE_SECRET = 'test-secret';
      fetchMock.mockRejectedValue(new Error('Network error'));
      const result = await verifyTurnstile('some-token', '127.0.0.1');
      expect(result).toBe(false);
    });

    it('includes ip in request body when provided', async () => {
      process.env.TURNSTILE_SECRET = 'test-secret';
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
      await verifyTurnstile('valid-token', '192.168.1.1');
      const [, options] = fetchMock.mock.calls[0];
      expect(options.body.toString()).toContain('remoteip=192.168.1.1');
    });
  });
});
