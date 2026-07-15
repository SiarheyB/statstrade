import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ENTRY_POINTS,
  DEFAULT_ENTRY_TYPES,
  DEFAULT_MISTAKES,
  DEFAULT_PATTERNS,
  UNSET_LABEL,
  parseOptions,
} from '@/lib/annotations';

describe('annotations', () => {
  it('exposes default option lists', () => {
    expect(DEFAULT_ENTRY_POINTS.length).toBeGreaterThan(0);
    expect(DEFAULT_ENTRY_TYPES).toContain('Консервативный');
    expect(DEFAULT_MISTAKES).toContain('Ранний вход');
    expect(DEFAULT_PATTERNS).toContain('Пробой');
    expect(UNSET_LABEL).toBe('Не задано');
  });

  it('parseOptions returns fallback when raw is null/empty', () => {
    expect(parseOptions(null, ['a'])).toEqual(['a']);
    expect(parseOptions(undefined, ['b'])).toEqual(['b']);
    expect(parseOptions('', ['c'])).toEqual(['c']);
  });

  it('parseOptions returns parsed array when valid', () => {
    expect(parseOptions('["x","y"]', ['fallback'])).toEqual(['x', 'y']);
  });

  it('parseOptions trims and drops empty entries', () => {
    expect(parseOptions('[" x ","", "  y  "]', ['fb'])).toEqual(['x', 'y']);
  });

  it('parseOptions falls back when not a string array', () => {
    expect(parseOptions('[1,2,3]', ['fb'])).toEqual(['fb']);
    expect(parseOptions('{"a":1}', ['fb'])).toEqual(['fb']);
  });

  it('parseOptions falls back on invalid JSON', () => {
    expect(parseOptions('not json', ['fb'])).toEqual(['fb']);
  });

  it('parseOptions falls back when array is empty after clean', () => {
    expect(parseOptions('["","  "]', ['fb'])).toEqual(['fb']);
  });
});