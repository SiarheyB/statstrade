import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminForex from '@/components/AdminForex';

function makePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    now: '2026-07-19T12:00:00Z',
    health: {
      ok: true,
      data: {
        healthy: true,
        uptimeMs: 3600_000,
        instruments: 5,
        backfillDone: true,
        ws: { connected: true, reconnects: 0, totalTrades: 1234, lastTradeAt: '2026-07-19T11:59:00Z' },
        twelveData: { apiKeySet: true, totalCalls: 10, fallbackIntervalSec: 30 },
        errors: 0,
        lastWriteOkAt: '2026-07-19T11:59:00Z',
        exchange: 'finnhub',
      },
    },
    symbols: ['EURUSD'],
    intervals: ['5m', '1h'],
    bySymbol: {
      EURUSD: {
        '5m': { count: 100, lastT: '2026-07-19T11:59:00Z', oldestT: '2026-07-18T00:00:00Z' },
        '1h': { count: 50, lastT: '2026-07-19T11:00:00Z', oldestT: '2026-07-18T00:00:00Z' },
      },
    },
    config: [],
    envSymbols: [],
    ...overrides,
  };
}

describe('AdminForex', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows loading state initially', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<AdminForex />);
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();
  });

  it('shows online status and collector stats', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makePayload()) }));

    render(<AdminForex />);

    await waitFor(() => {
      expect(screen.getByText(/forex-collector:/)).toBeInTheDocument();
    });
    expect(screen.getByText(/online/)).toBeInTheDocument();
    expect(screen.getByText(/подключён/)).toBeInTheDocument();
    expect(screen.getByText('EURUSD')).toBeInTheDocument();
  });

  it('shows offline/unavailable status when health check fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve(
            makePayload({
              health: { ok: false, error: 'connection refused' },
            }),
          ),
      }),
    );

    render(<AdminForex />);

    await waitFor(() => {
      expect(screen.getByText(/недоступен/)).toBeInTheDocument();
    });
    expect(screen.getByText('connection refused')).toBeInTheDocument();
  });

  it('shows stale-pair warning banner when a candle lags far behind', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve(
            makePayload({
              bySymbol: {
                EURUSD: {
                  '5m': { count: 5, lastT: '2026-07-19T00:00:00Z', oldestT: '2026-07-18T00:00:00Z' },
                  '1h': { count: 5, lastT: '2026-07-19T00:00:00Z', oldestT: '2026-07-18T00:00:00Z' },
                },
              },
            }),
          ),
      }),
    );

    render(<AdminForex />);

    await waitFor(() => {
      expect(screen.getByText(/не обновляются на 5m/)).toBeInTheDocument();
    });
  });

  it('shows error banner on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    render(<AdminForex />);

    await waitFor(() => {
      expect(screen.getByText(/Ошибка загрузки/)).toBeInTheDocument();
    });
  });

  it('shows empty state message when no symbols configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makePayload({ symbols: [], bySymbol: {} })),
      }),
    );

    render(<AdminForex />);

    await waitFor(() => {
      expect(screen.getByText('Данных пока нет')).toBeInTheDocument();
    });
  });
});
