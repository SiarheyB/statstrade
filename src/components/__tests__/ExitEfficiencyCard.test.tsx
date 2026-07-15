import { render, screen, act } from '@testing-library/react';
import { ExitEfficiencyCard } from '@/components/ExitEfficiencyCard';

// Mock all dependencies to avoid mocking complexity
vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));
vi.mock('@/lib/format', () => ({
  fmtPct: (val: number) => `${val.toFixed(2)}%`,
  fmtUsd: (val: number) => `$${val}`,
  fmtSymbol: (val: string) => val,
}));
vi.mock('@/lib/analytics/scopeLabel', () => ({
  scopeLabel: () => 'All trades',
}));
vi.mock('@/lib/analytics/exitEfficiency', () => ({
  computeExitEfficiency: vi.fn(),
  pickRecentTrades: () => [],
}));

// Mock fetch globally - return disabled feature so component renders nothing
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ value: { enabled: false } }),
});
global.fetch = mockFetch;

describe('ExitEfficiencyCard', () => {
  it('renders without errors', () => {
    // Simple render test - if no error thrown, test passes
    expect(() => {
      act(() => {
        render(<ExitEfficiencyCard trades={[]} accounts={[]} />);
      });
    }).not.toThrow();
  });
});