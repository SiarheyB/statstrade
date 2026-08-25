import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminForex from '@/components/AdminForex';

function makePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    now: '2026-07-20T12:00:00Z',
    health: {
      ok: true,
      data: {
        healthy: true,
        uptimeMs: 3600_000,
        instruments: 5,
        backfillDone: true,
        ws: { connected: true, reconnects: 0, totalTrades: 1234, lastTradeAt: '2026-07-20T11:59:00Z' },
        twelveData: { apiKeySet: true, totalCalls: 10, fallbackIntervalSec: 30 },
        errors: 0,
        lastWriteOkAt: '2026-07-20T11:59:00Z',
        exchange: 'finnhub',
      },
    },
    symbols: ['EURUSD'],
    intervals: ['5m', '1h'],
    bySymbol: {
      EURUSD: {
        '5m': { count: 100, lastT: '2026-07-20T11:59:00Z', oldestT: '2026-07-19T00:00:00Z' },
        '1h': { count: 50, lastT: '2026-07-20T11:00:00Z', oldestT: '2026-07-19T00:00:00Z' },
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

  it('не считает отстающими пары, которые больше не собираются', async () => {
    // В FxCandle остались свечи снятых пар — раньше они навсегда поднимали
    // тревогу «N из N пар не обновляются», хотя собирается только золото.
    const payload = makePayload({
      symbols: ['EUR/USD', 'XAU/USD'],
      health: {
        ok: true,
        data: {
          healthy: true,
          uptimeMs: 3600_000,
          instruments: 1,
          symbols: ['XAU/USD'],
          backfillDone: true,
          ws: { connected: false, reconnects: 0, totalTrades: 0, lastTradeAt: null },
          twelveData: { apiKeySet: false, totalCalls: 0, fallbackIntervalSec: 30 },
          dukascopy: {
            symbols: ['XAU/USD'],
            pollSec: 15,
            totalCalls: 1106,
            errors: 2,
            lastOkAt: '2026-07-20T11:59:50Z',
            lastError: { at: '2026-07-20T11:30:00Z', symbol: 'XAU/USD', interval: '1m', message: 'HTTP 503' },
          },
          errors: 0,
          lastWriteOkAt: '2026-07-20T11:59:00Z',
          exchange: 'finnhub',
        },
      },
      bySymbol: {
        'EUR/USD': { '5m': { count: 3905, lastT: '2026-07-17T12:00:00Z', oldestT: '2026-07-01T00:00:00Z' } },
        'XAU/USD': { '5m': { count: 5203, lastT: '2026-07-20T11:58:00Z', oldestT: '2026-07-01T00:00:00Z' } },
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));

    render(<AdminForex />);

    await waitFor(() => expect(screen.getByText('не собирается')).toBeInTheDocument());
    // Тревоги нет: единственная собираемая пара свежая
    expect(screen.queryByText(/не обновляются на 5m/)).not.toBeInTheDocument();
    // Зато видно, что за ошибка была у источника
    expect(screen.getByText(/HTTP 503/)).toBeInTheDocument();
    // И есть чем убрать мёртвые данные
    expect(screen.getByTitle('Удалить свечи этой пары из FxCandle')).toBeInTheDocument();
  });

  it('старые ошибки источника не держат строку красной', async () => {
    // 8 осечек за 13 часов работы, последняя — 12 часов назад: данные идут,
    // краснеть не из-за чего
    const payload = makePayload({
      health: {
        ok: true,
        data: {
          healthy: true,
          uptimeMs: 13 * 3600_000,
          instruments: 1,
          symbols: ['XAU/USD'],
          backfillDone: true,
          ws: { connected: false, reconnects: 0, totalTrades: 0, lastTradeAt: null },
          twelveData: { apiKeySet: false, totalCalls: 0, fallbackIntervalSec: 30 },
          dukascopy: {
            symbols: ['XAU/USD'], pollSec: 15, totalCalls: 4716, errors: 8, failStreak: 0,
            lastOkAt: '2026-07-20T11:59:50Z',
            lastError: { at: '2026-07-20T00:00:00Z', symbol: 'XAU/USD', interval: '1m', message: 'fetch failed' },
          },
          ticks: {
            pollSec: 5, limit: 500, totalCalls: 8570, errors: 10,
            lastOkAt: '2026-07-20T11:59:55Z',
            lastError: { at: '2026-07-20T04:00:00Z', symbol: 'XAU/USD', message: 'timeout' },
          },
          errors: 0,
          lastWriteOkAt: '2026-07-20T11:59:00Z',
          exchange: 'finnhub',
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));

    render(<AdminForex />);

    const dukas = await screen.findByText(/Dukascopy \(основной\)/);
    expect(dukas.className).toContain('text-muted');
    expect(dukas.className).not.toContain('text-loss');
    const ticks = screen.getByText(/тики: раз в/);
    expect(ticks.className).not.toContain('text-loss');
    // сами счётчики при этом видны — диагностику не прячем
    expect(dukas.textContent).toContain('ошибок: 8');
  });

  it('свежая ошибка и серия сбоев красят строку', async () => {
    const payload = makePayload({
      now: '2026-07-20T12:00:00Z',
      health: {
        ok: true,
        data: {
          healthy: true,
          uptimeMs: 3600_000,
          instruments: 1,
          symbols: ['XAU/USD'],
          backfillDone: true,
          ws: { connected: false, reconnects: 0, totalTrades: 0, lastTradeAt: null },
          twelveData: { apiKeySet: false, totalCalls: 0, fallbackIntervalSec: 30 },
          dukascopy: {
            symbols: ['XAU/USD'], pollSec: 15, totalCalls: 100, errors: 3, failStreak: 2,
            lastOkAt: '2026-07-20T11:40:00Z',
            lastError: { at: '2026-07-20T11:59:00Z', symbol: 'XAU/USD', interval: '1m', message: 'HTTP 503' },
          },
          ticks: {
            pollSec: 5, limit: 500, totalCalls: 200, errors: 1,
            lastOkAt: '2026-07-20T11:59:50Z',
            lastError: { at: '2026-07-20T11:58:00Z', symbol: 'XAU/USD', message: 'timeout' },
          },
          errors: 0,
          lastWriteOkAt: '2026-07-20T11:59:00Z',
          exchange: 'finnhub',
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));

    render(<AdminForex />);

    const dukas = await screen.findByText(/Dukascopy \(основной\)/);
    expect(dukas.className).toContain('text-loss');
    expect(screen.getByText(/тики: раз в/).className).toContain('text-loss');
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
    // Finnhub теперь резерв: в штатном режиме он и должен быть «в резерве»,
    // а не «подключён» — данные идут из Dukascopy.
    expect(screen.getByText(/Finnhub WS: в резерве/)).toBeInTheDocument();
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
                  '5m': { count: 5, lastT: '2026-07-20T00:00:00Z', oldestT: '2026-07-19T00:00:00Z' },
                  '1h': { count: 5, lastT: '2026-07-20T00:00:00Z', oldestT: '2026-07-19T00:00:00Z' },
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

  // Форекс не торгуется на выходных: свечей нет ни у одного источника, и
  // предупреждение об отставании там означало бы «всё сломано» каждую субботу.
  it('на выходных не ругается на отставание, а объясняет, что рынок закрыт', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve(
            makePayload({
              now: '2026-07-18T12:00:00Z', // суббота
              bySymbol: {
                EURUSD: {
                  '5m': { count: 5, lastT: '2026-07-17T20:59:00Z', oldestT: '2026-07-10T00:00:00Z' },
                  '1h': { count: 5, lastT: '2026-07-17T20:00:00Z', oldestT: '2026-07-10T00:00:00Z' },
                },
              },
            }),
          ),
      }),
    );

    render(<AdminForex />);

    await waitFor(() => {
      expect(screen.getByText(/Валютный рынок закрыт/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/не обновляются на 5m/)).not.toBeInTheDocument();
  });

  it('показывает источник Dukascopy, когда коллектор о нём сообщает', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => {
          const p = makePayload();
          (p.health.data as Record<string, unknown>).dukascopy = {
            symbols: ['XAU/USD'],
            pollSec: 15,
            totalCalls: 42,
            errors: 0,
            lastOkAt: '2026-07-20T11:59:30Z',
          };
          return Promise.resolve(p);
        },
      }),
    );

    render(<AdminForex />);

    await waitFor(() => {
      expect(screen.getByText(/Dukascopy \(основной\): XAU\/USD · 42 запросов/)).toBeInTheDocument();
    });
  });

  it('различает «ключ Finnhub не задан» и штатный резерв', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => {
          const p = makePayload();
          (p.health.data as Record<string, unknown>).ws = {
            apiKeySet: false, connected: false, reconnects: 0, totalTrades: 0, lastTradeAt: null,
          };
          return Promise.resolve(p);
        },
      }),
    );

    render(<AdminForex />);

    await waitFor(() => {
      expect(screen.getByText(/Finnhub WS: ключ не задан/)).toBeInTheDocument();
    });
  });

  it('показывает, что резерв подхватил сбор, когда Dukascopy молчит', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => {
          const p = makePayload();
          (p.health.data as Record<string, unknown>).fallbackActive = true;
          return Promise.resolve(p);
        },
      }),
    );

    render(<AdminForex />);

    await waitFor(() => {
      expect(screen.getByText(/ПОДХВАТИЛ \(Dukascopy молчит\)/)).toBeInTheDocument();
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
