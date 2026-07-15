import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { encrypt, decrypt, maskSecret } from '../crypto';

const TEST_KEY = '00ff11ee22dd33cc44bb55aa669900ff11ee22dd33cc44bb55aa669900ff1122';

describe('crypto encrypt/decrypt', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', TEST_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('encrypts and decrypts', () => {
    const plain = 'hello world';
    const encrypted = encrypt(plain);
    expect(encrypted).not.toBe(plain);
    expect(decrypt(encrypted)).toBe(plain);
  });

  it('encodes unicode', () => {
    const plain = 'ключ❤️';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });
});

describe('maskSecret', () => {
  it('fully masks when visible >= length', () => {
    expect(maskSecret('ab', 4)).toBe('••');
    expect(maskSecret('abc', 4)).toBe('•••');
    expect(maskSecret('hello', 5)).toBe('•••••');
  });

  it('uses up to 4 bullets for longer strings', () => {
    expect(maskSecret('hello', 2)).toBe('••••lo');
    expect(maskSecret('secret', 2)).toBe('••••et');
  });
});