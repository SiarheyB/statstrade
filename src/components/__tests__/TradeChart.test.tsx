import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TradeChart } from '@/components/TradeChart';

// Mock i18n
vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

// Mock format
vi.mock('@/lib/format', () => ({
  fmtPrice: (val: number) => val.toFixed(2),
  fmtPct: (val: number) => `${val.toFixed(2)}%`,
}));

// Mock exitAnalysis
vi.mock('@/lib/analytics/exitAnalysis', () => ({
  computeExitAnalysis: vi.fn().mockReturnValue({
    mfePct: 5.5,
    maePct: -2.3,
    capturedPct: 70,
    bestPrice: 51500,
  }),
  candlesLookReal: vi.fn().mockReturnValue(false),
}));

// Global fetch mock
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Configure fetch to immediately return empty data (no real candles)
mockFetch.mockImplementation(() => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({ candles: [], fills: [] })
}));

const mockTrade = {
  id: 'trade-123',
  symbol: 'BTCUSDT',
  market: 'futures',
  exchange: 'bybit',
  side: 'long' as const,
  entryPrice: 50000,
  exitPrice: 51000,
  netPnl: 100,
  quantity: 0.1,
  fees: 5,
  entryTime: Date.now() - 3600000,
  exitTime: Date.now(),
  accountId: 'acc-1',
  stopLoss: 49000,
};

describe('TradeChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Configure fetch to return empty data (no real candles) so it falls back to schematic
    mockFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ candles: [], fills: [] })
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing when trade data is provided', () => {
    render(<TradeChart trade={mockTrade} />);

    // If it's in loading state, that's expected
    expect(screen.queryByText('trades.chart.loading')).toBeInTheDocument() ||
           screen.queryByText('trades.chart.schematic').toBeInTheDocument();
  });

  it('renders with SL when stopLoss is provided', async () => {
    const tradeWithSl = { ...mockTrade, stopLoss: 49000 };

    render(<TradeChart trade={tradeWithSl} />);

    await waitFor(() => {
      expect(screen.queryByText('trades.chart.loading')).not.toBeInTheDocument();
    }, { timeout: 3000 });

    // SL should appear in the legend (both svg text and legend span)
    expect(screen.getAllByText(/SL/).length).toBeGreaterThan(0);
    // Price value 49000.00 appears multiple times (svg + legend)
    expect(screen.getAllByText(/49000\.00/).length).toBeGreaterThan(0);
  });

  it('renders without SL when stopLoss is undefined', async () => {
    const tradeWithoutSl = { ...mockTrade, stopLoss: undefined };

    render(<TradeChart trade={tradeWithoutSl} />);

    await waitFor(() => {
      expect(screen.queryByText('trades.chart.loading')).not.toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.queryByText(/SL/)).not.toBeInTheDocument();
  });

  it('handles short trades correctly', async () => {
    const shortTrade = { ...mockTrade, side: 'short' as const, entryPrice: 51000, exitPrice: 50000 };

    render(<TradeChart trade={shortTrade} />);

    await waitFor(() => {
      expect(screen.queryByText('trades.chart.loading')).not.toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByText('trades.chart.schematic')).toBeInTheDocument();
  });

  it('renders SVG chart element', async () => {
    render(<TradeChart trade={mockTrade} />);

    await waitFor(() => {
      expect(screen.queryByText('trades.chart.loading')).not.toBeInTheDocument();
    }, { timeout: 3000 });

    const svg = document.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});