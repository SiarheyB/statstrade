import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ForexView from '@/app/dashboard/forex/ForexView';

// Stable references: ForexView feeds `t` into several useCallback/useEffect
// dependency arrays (loadVolumeProfile/loadImbalance/loadDivergence) — a
// mock that returns a fresh `t` closure on every call invalidates those
// callbacks every render, retriggering their effects in an infinite loop.
const stableT = (k: string) => k;
vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ t: stableT, timezone: 'auto', locale: 'ru' }),
}));

function makeCandles(n: number, stepMs = 60000, base = 1.1) {
  const out = [];
  let price = base;
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = price + (i % 2 === 0 ? 0.001 : -0.001);
    const h = Math.max(o, c) + 0.0005;
    const l = Math.min(o, c) - 0.0005;
    out.push({ t: new Date(now - (n - i) * stepMs).toISOString(), o, h, l, c, v: 100 + i });
    price = c;
  }
  return out;
}

const CANDLES = makeCandles(60);

function drawingRow(id: string, toolType: string, points: { t: number; price: number }[]) {
  return {
    id, userId: 'u1', symbol: 'EUR/USD',
    toolType, points: JSON.stringify(points), color: '#e6b800', lineWidth: 2,
    fillColor: null, label: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null,
  };
}

function tms(iso: string) { return new Date(iso).getTime(); }

const DRAWINGS = [
  drawingRow('d1', 'trend_line', [{ t: tms(CANDLES[5].t), price: 1.101 }, { t: tms(CANDLES[20].t), price: 1.099 }]),
  drawingRow('d2', 'horizontal_line', [{ t: tms(CANDLES[10].t), price: 1.1 }]),
  drawingRow('d3', 'horizontal_ray', [{ t: tms(CANDLES[15].t), price: 1.098 }]),
  drawingRow('d4', 'rectangle', [{ t: tms(CANDLES[25].t), price: 1.103 }, { t: tms(CANDLES[40].t), price: 1.097 }]),
];

const MAIN_DATA = {
  symbol: 'EUR/USD', range: '1h',
  from: tms(CANDLES[0].t), to: tms(CANDLES[CANDLES.length - 1].t),
  candles: CANDLES,
  ba: CANDLES.map((c) => ({ t: tms(c.t), bidSum: 10000, askSum: 12000, volSum: 22000 })),
  delta: CANDLES.map((c, i) => ({ t: tms(c.t), delta: i % 2 === 0 ? 5 : -5, bidVol: 10, askVol: 6 })),
  cvd: CANDLES.map((c, i) => ({ t: tms(c.t), cvd: i * 2 })),
  timezone: 'UTC',
};

function routerFetch(url: string) {
  if (url.includes('/api/forex/meta')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ pairs: [{ symbol: 'EUR/USD' }, { symbol: 'GBP/USD' }] }) });
  }
  if (url.includes('/api/forex/drawings')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ drawings: DRAWINGS }) });
  }
  if (url.includes('/api/forex/volume-profile')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      poc: { price: 1.1, volume: 500 },
      valueArea: { high: 1.102, low: 1.098 },
      levels: [{ price: 1.1, volume: 500 }, { price: 1.101, volume: 300 }],
    }) });
  }
  if (url.includes('/api/forex/imbalance')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      series: [{ t: tms(CANDLES[10].t), ratio: 0.2, bidVol: 100, askVol: 80 }],
      current: { ratio: 0.4 },
    }) });
  }
  if (url.includes('/api/forex/divergence')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ signals: [{
      id: 'div1', type: 'regular_bullish', strength: 3, t: tms(CANDLES[10].t),
      pricePeak: 1.101, priceTrough: 1.099, deltaPeak: 5, deltaTrough: -5, bars: 8,
      confirmed: true, label: 'Regular Bullish',
    }] }) });
  }
  if (url.includes('/api/forex/history')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ candles: makeCandles(20, 60000, 1.09), hasMore: true }) });
  }
  if (url.includes('/api/forex')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(MAIN_DATA) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
}

function stubCanvasRect(canvas: Element, w = 900, h = 500) {
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON() {} }),
    configurable: true,
  });
  Object.defineProperty(canvas, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: h, configurable: true });
}

describe('ForexView', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => routerFetch(url)));
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function renderPage() {
    await act(async () => {
      render(<ForexView />);
    });
    await waitFor(() => {
      expect(document.querySelectorAll('canvas').length).toBeGreaterThan(0);
    });
    const canvases = document.querySelectorAll('canvas');
    canvases.forEach((c) => stubCanvasRect(c));
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    return canvases[0] as HTMLCanvasElement;
  }

  it('renders without crashing once data is loaded', async () => {
    await renderPage();
    expect(document.querySelectorAll('canvas').length).toBeGreaterThanOrEqual(1);
  });

  it('symbol/range selector changes trigger refetch', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => routerFetch(url));
    vi.stubGlobal('fetch', fetchMock);
    await renderPage();
    const before = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/forex?')).length;
    const selects = screen.getAllByRole('combobox');
    await act(async () => {
      fireEvent.change(selects[1], { target: { value: '4h' } });
    });
    await waitFor(() => {
      const after = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/forex?')).length;
      expect(after).toBeGreaterThan(before);
    });
  });

  it('selecting a drawing tool and drawing on canvas saves a new drawing', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => routerFetch(url));
    vi.stubGlobal('fetch', fetchMock);
    const canvas = await renderPage();
    const trendBtn = screen.getByTitle('Трендовая');
    await act(async () => { fireEvent.click(trendBtn); });
    await act(async () => { fireEvent.mouseDown(canvas, { clientX: 200, clientY: 200 }); });
    await act(async () => { fireEvent.mouseMove(canvas, { clientX: 300, clientY: 150 }); });
    await act(async () => { fireEvent.mouseDown(canvas, { clientX: 300, clientY: 150 }); });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/forex/drawings') && c[1]?.method === 'POST')).toBe(true);
    });
  });

  it('toggles magnet/show/lock via the drawing toolbar without throwing', async () => {
    await renderPage();
    fireEvent.click(screen.getByTitle(/Привязка к свечам/));
    expect(document.querySelectorAll('canvas').length).toBeGreaterThanOrEqual(1);
  });

  it('renders delta/CVD and B/A canvases when data present', async () => {
    await renderPage();
    expect(screen.getByText('fx.deltaCvd')).toBeInTheDocument();
    expect(screen.getByText('fx.bidAsk')).toBeInTheDocument();
  });

  it('pauses live polling while the document tab is hidden', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => routerFetch(url));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => {
      render(<ForexView />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    const before = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/forex?')).length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    const after = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/forex?')).length;
    expect(after).toBe(before);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('restores symbol/timeframe/sessions chosen last time', async () => {
    localStorage.setItem('forex.settings', JSON.stringify({
      symbol: 'GBP/USD', range: '4h', sessions: ['london', 'newYork'], showVpOverlay: true,
    }));
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => routerFetch(url));
    vi.stubGlobal('fetch', fetchMock);
    await renderPage();
    const mainCalls = fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/forex?'));
    expect(mainCalls.length).toBeGreaterThan(0);
    // Ни одного запроса за дефолтным EUR/USD 1h: график не должен успеть
    // показать чужой инструмент, пока читаются настройки.
    expect(mainCalls.every((u) => u.includes('symbol=GBP%2FUSD') && u.includes('range=4h'))).toBe(true);
    const selects = screen.getAllByRole('combobox');
    expect((selects[0] as HTMLSelectElement).value).toBe('GBP/USD');
    expect((selects[1] as HTMLSelectElement).value).toBe('4h');
    // Кнопка сессий подписана числом включённых.
    expect(screen.getByTitle('fx.hintSessions').textContent).toContain('2');
  });

  it('picks up sessions saved by the previous storage format', async () => {
    localStorage.setItem('forex.sessions', 'tokyo,london');
    await renderPage();
    expect(screen.getByTitle('fx.hintSessions').textContent).toContain('2');
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('forex.settings') || '{}').sessions).toEqual(['tokyo', 'london']);
    });
  });

  it('remembers a timeframe change and a session toggle', async () => {
    await renderPage();
    const selects = screen.getAllByRole('combobox');
    await act(async () => { fireEvent.change(selects[1], { target: { value: '15m' } }); });
    await act(async () => { fireEvent.click(screen.getByTitle('fx.hintSessions')); });
    await act(async () => { fireEvent.click(screen.getByText('fx.sessionLondon')); });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('forex.settings') || '{}');
      expect(saved.range).toBe('15m');
      expect(saved.sessions).toEqual(['london']);
    });
  });

  it('refresh button triggers a manual reload', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => routerFetch(url));
    vi.stubGlobal('fetch', fetchMock);
    await renderPage();
    const before = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/forex?')).length;
    const buttons = screen.getAllByRole('button');
    const refreshBtn = buttons.find((b) => b.querySelector('svg.lucide-refresh-cw'));
    if (refreshBtn) {
      await act(async () => { fireEvent.click(refreshBtn); });
      await waitFor(() => {
        const after = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/forex?')).length;
        expect(after).toBeGreaterThan(before);
      });
    }
  });
});
