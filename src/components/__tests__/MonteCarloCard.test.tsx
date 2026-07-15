import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MonteCarloCard } from '@/components/MonteCarloCard';

// Mock i18n
vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, number | string>) => {
      if (params) return key + JSON.stringify(params);
      return key;
    },
  }),
}));

// Mock format
vi.mock('@/lib/format', () => ({
  fmtPct: (val: number, digits = 1) => `${val.toFixed(digits)}%`,
  fmtUsd: (val: number) => `$${val}`,
}));

// Mock scopeLabel
vi.mock('@/lib/analytics/scopeLabel', () => ({
  scopeLabel: () => 'All trades',
}));

// Mock runMonteCarlo
vi.mock('@/lib/analytics/monteCarlo', () => ({
  runMonteCarlo: vi.fn().mockReturnValue({
    riskOfRuinPct: 5.2,
    p5: 0.85,
    p50: 1.15,
    p95: 1.45,
    simulations: 200,
    projectedTrades: 100,
  }),
}));

// Mock feature fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockTrades = Array.from({ length: 10 }, (_, i) => ({
  id: `t${i}`,
  netPnl: (i % 2 === 0 ? 100 : -50) + Math.random() * 10,
  entryTime: Date.now() + i * 86400000,
  exitTime: Date.now() + (i + 1) * 86400000,
  symbol: 'BTCUSDT',
  side: 'long',
  entryPrice: 50000,
  exitPrice: 51000,
  quantity: 0.1,
  fees: 5,
  accountId: 'acc1',
}));

const mockCapital = 10000;
const mockAccounts = [{ id: 'acc1', name: 'Account 1', exchange: 'bybit' }];

const defaultProps = {
  trades: mockTrades,
  capital: mockCapital,
  accounts: mockAccounts,
};

describe('MonteCarloCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ value: { enabled: true, simulations: 200, projectedTrades: 100, ruinDrawdownPct: 20 } }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when feature is disabled', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ value: { enabled: false, simulations: 200, projectedTrades: 100, ruinDrawdownPct: 20 } }),
    });

    render(<MonteCarloCard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByText('an.monteCarlo')).not.toBeInTheDocument();
    });
  });

  it('renders nothing when not enough trades', async () => {
    render(<MonteCarloCard {...defaultProps} trades={mockTrades.slice(0, 3)} />);

    await waitFor(() => {
      expect(screen.queryByText('an.monteCarlo')).not.toBeInTheDocument();
    });
  });

  it('renders nothing when capital is zero', async () => {
    render(<MonteCarloCard {...defaultProps} capital={0} />);

    await waitFor(() => {
      expect(screen.queryByText('an.monteCarlo')).not.toBeInTheDocument();
    });
  });

  it('renders card with run button when feature enabled and data sufficient', async () => {
    render(<MonteCarloCard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('an.monteCarlo')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /an\.monteCarloRun/ })).toBeInTheDocument();
  });

  it('shows loading state when run button clicked', async () => {
    render(<MonteCarloCard {...defaultProps} />);

    await waitFor(() => {
      const runButton = screen.getByRole('button', { name: /an\.monteCarloRun/ });
      fireEvent.click(runButton);
    });

    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('displays results after run completes', async () => {
    render(<MonteCarloCard {...defaultProps} />);

    await waitFor(() => {
      const runButton = screen.getByRole('button', { name: /an\.monteCarloRun/ });
      fireEvent.click(runButton);
    });

    await waitFor(() => {
      // Форматируемые проценты (mock fmtPct с digits=0): -15%, 15%, 45%
      // и riskOfRuinPct через toFixed(1): 5.2%
      expect(screen.getAllByText("-15%").length).toBeGreaterThan(0);
      expect(screen.getAllByText("15%").length).toBeGreaterThan(0);
      expect(screen.getAllByText("45%").length).toBeGreaterThan(0);
      expect(screen.getAllByText("5.2%").length).toBeGreaterThan(0);
    });
  });

  it('displays scope label when available', async () => {
    render(<MonteCarloCard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('an.scopeLabel')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Look for scope text - it might be split across elements
    const scopeText = screen.getAllByText(/All trades|scope|All/);
    expect(scopeText.length).toBeGreaterThan(0);
  });

  it('shows note with simulation count after run', async () => {
    render(<MonteCarloCard {...defaultProps} />);

    await waitFor(() => {
      const runButton = screen.getByRole('button', { name: /an\.monteCarloRun/ });
      fireEvent.click(runButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/an\.monteCarloNote.*sims.*200.*steps.*100/)).toBeInTheDocument();
    });
  });
});