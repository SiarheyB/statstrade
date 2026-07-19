import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AdminCollector from '@/components/AdminCollector';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (key === 'admin.collector.retention') return `snapshots ${vars?.days} d`;
      if (key === 'admin.collector.tradeRetention') return `trades ${vars?.days} d`;
      return key;
    },
    locale: 'en',
  }),
}));

function makePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    now: '2026-07-19T12:00:00Z',
    feeds: [],
    series: [],
    tableStats: [],
    preview: null,
    collector: {
      ok: true,
      data: {
        healthy: true,
        uptimeMs: 3600_000,
        snapshotMs: 2000,
        depthPct: 0.02,
        retentionDays: 7,
        tradeRetentionDays: 30,
        feeds: [],
        ...overrides,
      },
    },
  };
}

describe('AdminCollector', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows both retention values in the status bar', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makePayload()),
    });

    render(<AdminCollector />);

    await waitFor(() => {
      expect(screen.getByText('snapshots 7 d')).toBeInTheDocument();
    });
    expect(screen.getByText('trades 30 d')).toBeInTheDocument();
  }, 15000);

  it('shows snapshots retention as 14 and trade retention as 90', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makePayload({ retentionDays: 14, tradeRetentionDays: 90 })),
    });

    render(<AdminCollector />);

    await waitFor(() => {
      expect(screen.getByText('snapshots 14 d')).toBeInTheDocument();
    });
    expect(screen.getByText('trades 90 d')).toBeInTheDocument();
  }, 15000);

  it('shows offline status without retention values when collector is unavailable', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        now: '2026-07-19T12:00:00Z',
        feeds: [],
        series: [],
        tableStats: [],
        preview: null,
        collector: { ok: false, error: 'collector offline' },
      }),
    });

    render(<AdminCollector />);

    // Wait for component to render with offline status
    await waitFor(() => {
      expect(screen.getByText(/unavailable/)).toBeInTheDocument();
    });
    // Should NOT show any retention values when collector is offline
    expect(screen.queryByText(/snapshots/)).not.toBeInTheDocument();
    expect(screen.queryByText(/trades/)).not.toBeInTheDocument();
  }, 15000);
});