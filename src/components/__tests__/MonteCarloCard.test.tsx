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

// Mock feature fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Симуляция считается на сервере (/api/monte-carlo), поэтому карточке нужны
// только область расчёта, капитал и число сделок — сам массив сделок больше
// не передаётся.
const mockResult = {
  riskOfRuinPct: 5.2,
  p5: 0.85,
  p50: 1.15,
  p95: 1.45,
  simulations: 200,
  projectedTrades: 100,
};

const defaultProps = {
  scope: [{ accountId: 'acc1', exchange: 'bybit' }],
  accounts: [{ id: 'acc1', label: 'Account 1', exchange: 'bybit', balance: null }],
  accountId: 'all',
  capital: 10000,
  tradeCount: 10,
};

describe('MonteCarloCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFetch.mockImplementation((url: string) => {
      if (String(url).startsWith('/api/monte-carlo')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: mockResult, trades: 10 }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ value: { enabled: true, simulations: 200, projectedTrades: 100, ruinDrawdownPct: 20 } }),
      });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when feature is disabled', async () => {
    mockFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ value: { enabled: false, simulations: 200, projectedTrades: 100, ruinDrawdownPct: 20 } }),
    }));

    render(<MonteCarloCard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByText('an.monteCarlo')).not.toBeInTheDocument();
    });
  });

  it('renders nothing when not enough trades', async () => {
    render(<MonteCarloCard {...defaultProps} tradeCount={3} />);

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

  it('shows loading state while the server is computing', async () => {
    // Расчёт уехал на сервер, поэтому «загрузка» держится до ответа запроса —
    // подвешиваем его, чтобы состояние вообще успело отрисоваться.
    let release!: (v: unknown) => void;
    const pending = new Promise((r) => { release = r; });
    mockFetch.mockImplementation((url: string) => {
      if (String(url).startsWith('/api/monte-carlo')) {
        return pending.then(() => ({ ok: true, json: () => Promise.resolve({ result: mockResult, trades: 10 }) }));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ value: { enabled: true, simulations: 200, projectedTrades: 100, ruinDrawdownPct: 20 } }),
      });
    });

    render(<MonteCarloCard {...defaultProps} />);
    const runButton = await screen.findByRole('button', { name: /an\.monteCarloRun/ });
    fireEvent.click(runButton);

    await waitFor(() => expect(screen.getByText('common.loading')).toBeInTheDocument());
    await act(async () => { release(null); });
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