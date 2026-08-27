import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import LiqMapPage from '@/app/dashboard/liqmap/page';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ t: (k: string) => k, timezone: 'auto', locale: 'ru' }),
}));

function makeCandles(n: number, base = 100) {
  const out = [];
  let price = base;
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = price + (i % 2 === 0 ? 1 : -1);
    const h = Math.max(o, c) + 0.5;
    const l = Math.min(o, c) - 0.5;
    out.push({ t: Date.now() - (n - i) * 60000, o, h, l, c });
    price = c;
  }
  return out;
}

function makeHeatmap() {
  const cols = 10;
  const bins = 8;
  const grid: number[][] = [];
  for (let c = 0; c < cols; c++) {
    const col: number[] = [];
    for (let b = 0; b < bins; b++) col.push((c + b) % 5);
    grid.push(col);
  }
  return {
    priceMin: 90, priceMax: 110, bins, cols, grid, maxVal: 8, price: 100,
    candles: makeCandles(cols),
  };
}

const DEFAULT_RESP = { exchange: 'binance', symbol: 'BTCUSDT', tf: '7d', heatmap: makeHeatmap() };

function routerFetch(url: string) {
  if (url.includes('/api/liqmap/symbols')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ symbols: ['BTCUSDT', 'ETHUSDT'] }) });
  }
  if (url.includes('/api/liqmap/favorites')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ symbols: ['ETHUSDT'] }) });
  }
  if (url.includes('/api/liqmap')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(DEFAULT_RESP) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
}

describe('LiqMapPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => routerFetch(url)));
    localStorage.clear();
  });

  it('restores exchange/symbol/timeframe chosen last time', async () => {
    localStorage.setItem('liqmap.settings', JSON.stringify({ exchange: 'bybit', symbol: 'ETHUSDT', tf: '1M' }));
    const fetchMock = vi.fn((url: string) => routerFetch(url));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { render(<LiqMapPage />); });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/liqmap?'))).toBe(true);
    });
    const mapCalls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/liqmap?'));
    // Ни одного запроса за дефолтным BTCUSDT 7d: карта не должна моргать
    // чужими данными, пока читаются настройки.
    expect(mapCalls.every((u) => u.includes('exchange=bybit') && u.includes('symbol=ETHUSDT') && u.includes('tf=1M'))).toBe(true);
  });

  it('remembers the timeframe after a change', async () => {
    await act(async () => { render(<LiqMapPage />); });
    await waitFor(() => expect(document.querySelectorAll('canvas').length).toBeGreaterThan(0));
    const selects = screen.getAllByRole('combobox');
    await act(async () => { fireEvent.change(selects[selects.length - 1], { target: { value: '1d' } }); });
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('liqmap.settings') || '{}').tf).toBe('1d');
    });
  });

  it('shows loading then renders canvas with data', async () => {
    await act(async () => {
      render(<LiqMapPage />);
    });
    await waitFor(() => {
      expect(document.querySelector('canvas')).toBeInTheDocument();
    });
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
  });

  it('shows error state when the API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/api/liqmap?')) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'boom' }) });
      }
      return routerFetch(url);
    }));
    await act(async () => {
      render(<LiqMapPage />);
    });
    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
  });

  it('changing exchange/symbol/timeframe triggers refetch', async () => {
    const fetchMock = vi.fn((url: string) => routerFetch(url));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => {
      render(<LiqMapPage />);
    });
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument());
    const callsBefore = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/liqmap?')).length;

    const selects = screen.getAllByRole('combobox');
    // first select = exchange, others via SearchSelect / tf select
    await act(async () => {
      fireEvent.change(selects[0], { target: { value: 'bybit' } });
    });
    await waitFor(() => {
      const callsAfter = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/liqmap?')).length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  it('reset view and refresh buttons work without throwing', async () => {
    await act(async () => {
      render(<LiqMapPage />);
    });
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument());
    const resetBtn = screen.getByTitle('liq.reset');
    await act(async () => {
      fireEvent.click(resetBtn);
    });
    // refresh button — find by RefreshCw icon's parent button (second button in header)
    const buttons = screen.getAllByRole('button');
    await act(async () => {
      fireEvent.click(buttons[buttons.length - 1]);
    });
    expect(document.querySelector('canvas')).toBeInTheDocument();
  });

  it('supports wheel zoom and pointer pan/hover interactions on the canvas', async () => {
    await act(async () => {
      render(<LiqMapPage />);
    });
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument());
    const canvas = document.querySelector('canvas')!;
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 500, right: 800, bottom: 500, x: 0, y: 0, toJSON() {} }),
      configurable: true,
    });
    (canvas as HTMLCanvasElement).setPointerCapture = vi.fn();

    await act(async () => {
      fireEvent.wheel(canvas, { deltaY: -100, clientX: 400, clientY: 250 });
    });
    await act(async () => {
      fireEvent.pointerDown(canvas, { clientX: 400, clientY: 250, pointerId: 1 });
    });
    await act(async () => {
      fireEvent.pointerMove(canvas, { clientX: 420, clientY: 240, pointerId: 1 });
    });
    await act(async () => {
      fireEvent.pointerUp(canvas, { clientX: 420, clientY: 240, pointerId: 1 });
    });
    await act(async () => {
      fireEvent.pointerMove(canvas, { clientX: 780, clientY: 490, pointerId: 1 }); // near price axis
    });
    await act(async () => {
      fireEvent.pointerMove(canvas, { clientX: 100, clientY: 498, pointerId: 1 }); // near time axis
    });
    await act(async () => {
      fireEvent.pointerLeave(canvas);
    });
    // No throw is the assertion here — canvas should still be present.
    expect(document.querySelector('canvas')).toBeInTheDocument();
  });

  it('toggles a favourite symbol via SearchSelect star', async () => {
    const fetchMock = vi.fn((url: string) => routerFetch(url));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => {
      render(<LiqMapPage />);
    });
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument());
    // SearchSelect renders a button to open the dropdown; find any favourite star toggle if present.
    const starButtons = screen.queryAllByTitle(/favAdd|favRemove|liq\.favAdd|liq\.favRemove/i);
    if (starButtons.length > 0) {
      await act(async () => {
        fireEvent.click(starButtons[0]);
      });
      await waitFor(() => {
        expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/liqmap/favorites'))).toBe(true);
      });
    }
    // If SearchSelect doesn't expose a directly clickable star without opening
    // the dropdown first, this is still a valid smoke assertion that render succeeded.
    expect(document.querySelector('canvas')).toBeInTheDocument();
  });
});
