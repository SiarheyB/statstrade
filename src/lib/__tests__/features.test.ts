/**
 * Тесты для features.ts — конфигурация опциональных фич
 * src/lib/features.ts
 */

import { describe, it, expect } from 'vitest';

import {
  FEATURE_DEFAULTS,
  FEATURE_META_KEYS,
  type FeatureKey,
  type FeatureConfigValue,
} from '@/lib/features';

describe('features - FEATURE_DEFAULTS', () => {
  it('contains all expected feature keys', () => {
    const keys = Object.keys(FEATURE_DEFAULTS) as FeatureKey[];
    expect(keys).toEqual([
      'exitEfficiency',
      'monteCarlo',
      'playbooks',
      'mentorMode',
      'volumeProfile',
      'divergenceScanner',
    ]);
  });

  it('each feature has required fields: enabled, numeric params, meta', () => {
    for (const key of Object.keys(FEATURE_DEFAULTS) as FeatureKey[]) {
      const def = FEATURE_DEFAULTS[key];
      // required runtime fields
      expect(def).toHaveProperty('label');
      expect(def).toHaveProperty('description');
      expect(def).toHaveProperty('fieldHelp');
      // at least one numeric config field besides meta
      const numericKeys = Object.keys(def).filter(
        (k) => !FEATURE_META_KEYS.includes(k as (typeof FEATURE_META_KEYS)[number])
      );
      expect(numericKeys.length).toBeGreaterThan(0);
      // all numeric fields should be numbers
      for (const nk of numericKeys) {
        expect(typeof def[nk as keyof typeof def]).toBe('number');
      }
    }
  });

  it('exitEfficiency has correct defaults', () => {
    expect(FEATURE_DEFAULTS.exitEfficiency.maxTrades).toBe(60);
    expect(FEATURE_DEFAULTS.exitEfficiency.concurrency).toBe(3);
  });

  it('monteCarlo has correct defaults', () => {
    expect(FEATURE_DEFAULTS.monteCarlo.simulations).toBe(1000);
    expect(FEATURE_DEFAULTS.monteCarlo.projectedTrades).toBe(100);
    expect(FEATURE_DEFAULTS.monteCarlo.ruinDrawdownPct).toBe(50);
  });

  it('playbooks has correct defaults', () => {
    expect(FEATURE_DEFAULTS.playbooks.maxPerUser).toBe(20);
  });

  it('mentorMode has correct defaults', () => {
    expect(FEATURE_DEFAULTS.mentorMode.maxLinksPerUser).toBe(5);
  });

  it('volumeProfile has correct defaults', () => {
    expect(FEATURE_DEFAULTS.volumeProfile.bins).toBe(100);
    expect(FEATURE_DEFAULTS.volumeProfile.valueAreaPct).toBe(0.7);
  });

  it('divergenceScanner has correct defaults', () => {
    expect(FEATURE_DEFAULTS.divergenceScanner.minStrength).toBe(2);
    expect(FEATURE_DEFAULTS.divergenceScanner.lookbackBars).toBe(50);
    expect(FEATURE_DEFAULTS.divergenceScanner.minDivergenceBars).toBe(5);
    expect(FEATURE_DEFAULTS.divergenceScanner.maxDivergenceBars).toBe(30);
  });
});

describe('features - types', () => {
  it('FeatureKey is correct union', () => {
    // This is a compile-time check; if it compiles, the type is correct
    const key: FeatureKey = 'exitEfficiency';
    expect(key).toBe('exitEfficiency');
  });

  it('FeatureConfigValue strips meta keys', () => {
    type TestVal = FeatureConfigValue<'exitEfficiency'>;
    // TestVal should have enabled, maxTrades, concurrency but NOT label/description/fieldHelp
    // This is a compile-time check via type assertion
    const val: TestVal = { enabled: true, maxTrades: 50, concurrency: 2 };
    expect(val.enabled).toBe(true);
    expect(val.maxTrades).toBe(50);
    expect(val.concurrency).toBe(2);
  });
});