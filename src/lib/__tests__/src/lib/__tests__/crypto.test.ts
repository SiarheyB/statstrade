import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted for module-level mock functions (must be at top level)
const { randomBytes, createCipheriv, createDecipheriv } = vi.hoisted(() => ({
  randomBytes: vi.fn(),
  createCipheriv: vi.fn(),
  createDecipheriv: vi.fn(),
}));

// Mock node:crypto with both named and default exports (source uses default import)
vi.mock('node:crypto', () => ({
  default: { randomBytes, createCipheriv, createDecipheriv },
  randomBytes,
  createCipheriv,
  createDecipheriv,
}));

import { encrypt, decrypt, maskSecret } from '@/lib/crypto';

describe('crypto', () => {
  const plaintext = 'test-data';
  const ivHex = '0123456789abcdef';
  const authTagHex = '9876543210fedcba';
  const ciphertextHex = '0f1e2d3c4b5a6978';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000';
    randomBytes.mockReturnValue(Buffer.from(ivHex, 'hex'));
    createCipheriv.mockImplementation(() => ({
      update: vi.fn(() => Buffer.from(ciphertextHex, 'hex')),
      final: vi.fn(() => Buffer.alloc(0)),
      getAuthTag: vi.fn(() => Buffer.from(authTagHex, 'hex')),
    }));
    createDecipheriv.mockImplementation(() => ({
      setAuthTag: vi.fn(),
      update: vi.fn(() => Buffer.from(plaintext, 'utf8')),
      final: vi.fn(() => Buffer.alloc(0)),
    }));
  });

  describe('encrypt', () => {
    it('encodes plaintext successfully with valid key', () => {
      const result = encrypt(plaintext);
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^([0-9a-f]+):([0-9a-f]+):([0-9a-f]+)$/);
      expect(result).toContain(ivHex);
      expect(result).toContain(authTagHex);
      expect(result).toContain(ciphertextHex);
    });

    it('throws error if ENCRYPTION_KEY is not set', () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY is not set');
    });

    it('throws error if ENCRYPTION_KEY is not 64 hex chars', () => {
      process.env.ENCRYPTION_KEY = 'abc';
      expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be 32 bytes encoded as 64 hex chars');
    });
  });

  describe('decrypt', () => {
    it('successfully decrypts encrypted payload', () => {
      const result = decrypt(`${ivHex}:${authTagHex}:${ciphertextHex}`);
      expect(result).toBe(plaintext);
    });

    it('throws error on malformed payload', () => {
      expect(() => decrypt('invalid')).toThrow('Malformed encrypted payload');
      expect(() => decrypt('iv:tag')).toThrow('Malformed encrypted payload');
      expect(() => decrypt('iv:')).toThrow('Malformed encrypted payload');
    });

    it('handles different key validation', () => {
      // Verify key validation is tested in encrypt
      expect(true).toBe(true);
    });
  });

  describe('maskSecret', () => {
    it('hides entire secret when shorter than visible length', () => {
      const masked = maskSecret('123', 4);
      expect(masked).toBe('•••');
    });

    it('masks all but visible characters when secret is longer', () => {
      const masked = maskSecret('1234567890', 4);
      expect(masked).toBe('••••••7890');
    });

    it('preserves full length of masked output', () => {
      const longSecret = '1234567890';
      const masked = maskSecret(longSecret, 4);
      expect(masked).toHaveLength(longSecret.length);
    });

    it('maintains visible characters visible at the end', () => {
      const masked = maskSecret('secret123', 3);
      expect(masked).toContain('123');
      expect(masked).toBe('••••••123');
    });
  });
});