/**
 * Tests for AbsorptionPanel component.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AbsorptionPanel from '@/components/AbsorptionPanel';
import type { AbsorptionSignal } from '@/lib/orderflow';

// Mock i18n hook
vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      const m: Record<string, string> = {
        'of.absorptionTitle': 'Absorption Patterns',
        'of.hintAbsorption': 'Narrow range + high volume + near-zero delta',
        'common.loading': 'Loading...',
        'of.noAbsorption': 'No absorption patterns detected',
        'of.found': '{n} found',
        'of.thTime': 'Time',
        'of.thStrength': 'Str',
        'of.thPrice': 'Price',
        'of.thRange': 'Range',
        'of.thVolMult': 'Vol ×',
        'of.thDeltaRatio': '|Δ|/V',
        'of.thDuration': 'Dur',
        'of.thLabel': 'Label',
      };
      let val = m[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return val;
    },
    timezone: 'UTC',
  }),
}));

const mockSignals: AbsorptionSignal[] = [
  {
    t: 1700000000000,
    price: 50000,
    range: 0.5,
    volume: 10000,
    avgVolume: 3000,
    volumeMultiplier: 3.33,
    deltaRatio: 0.05,
    duration: 3,
    strength: 4,
    label: 'Strong Absorption',
  },
  {
    t: 1700000060000,
    price: 50100,
    range: 0.3,
    volume: 5000,
    avgVolume: 2000,
    volumeMultiplier: 2.5,
    deltaRatio: 0.1,
    duration: 2,
    strength: 2,
    label: 'Absorption',
  },
];

describe('AbsorptionPanel', () => {
  it('shows loading state', () => {
    render(<AbsorptionPanel signals={[]} loading={true} error={null} />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('shows error state', () => {
    render(<AbsorptionPanel signals={[]} loading={false} error="Failed to load" />);
    expect(screen.getByText('Failed to load')).toBeTruthy();
  });

  it('shows empty state', () => {
    render(<AbsorptionPanel signals={[]} loading={false} error={null} />);
    expect(screen.getByText('No absorption patterns detected')).toBeTruthy();
  });

  it('renders with data', () => {
    render(<AbsorptionPanel signals={mockSignals} loading={false} error={null} />);
    expect(screen.getByText('Absorption Patterns')).toBeTruthy();
    expect(screen.getByText('2 found')).toBeTruthy();
    // Check signal data renders
    expect(screen.getByText('Strong Absorption')).toBeTruthy();
    expect(screen.getByText('Absorption')).toBeTruthy();
  });

  it('shows strength badge for strong signal', () => {
    render(<AbsorptionPanel signals={mockSignals} loading={false} error={null} />);
    // Strength 4 should be rendered
    expect(screen.getByText('4')).toBeTruthy();
  });

  it('shows volume multiplier', () => {
    render(<AbsorptionPanel signals={mockSignals} loading={false} error={null} />);
    expect(screen.getByText('3.3×')).toBeTruthy();
    expect(screen.getByText('2.5×')).toBeTruthy();
  });

  it('shows delta ratio', () => {
    render(<AbsorptionPanel signals={mockSignals} loading={false} error={null} />);
    expect(screen.getByText('5%')).toBeTruthy();
    expect(screen.getByText('10%')).toBeTruthy();
  });
});