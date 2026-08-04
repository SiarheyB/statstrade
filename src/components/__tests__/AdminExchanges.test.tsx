import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminExchanges from '@/components/AdminExchanges';

vi.mock('@/lib/exchangeIds', () => ({
  SUPPORTED_EXCHANGES: {
    binance: { name: 'Binance', docsUrl: 'https://binance.com/api-docs' },
    bybit: { name: 'Bybit' },
  },
}));

function makeRows() {
  return [
    { id: 'binance', name: 'Binance', needsPassphrase: false, supportsDemo: true, enabled: true, demoEnabled: false },
    { id: 'bybit', name: 'Bybit', needsPassphrase: true, supportsDemo: false, enabled: false, demoEnabled: false },
  ];
}

describe('AdminExchanges', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows loading state then rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('exchange-guides')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ guides: {} }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ exchanges: makeRows() }) });
      }),
    );

    render(<AdminExchanges />);
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Binance')).toBeInTheDocument();
    });
    expect(screen.getByText('Bybit')).toBeInTheDocument();
    expect(screen.getByText(/passphrase/)).toBeInTheDocument();
  });

  it('toggles enabled switch via PUT', async () => {
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (url.includes('exchange-guides')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ guides: {} }) });
      }
      if (opts?.method === 'PUT') {
        const rows = makeRows();
        rows[0].enabled = false;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ exchanges: rows }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ exchanges: makeRows() }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminExchanges />);
    await waitFor(() => expect(screen.getByText('Binance')).toBeInTheDocument());

    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/exchanges',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  it('expands a row to show the guide editor and saves it', async () => {
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (url.includes('exchange-guides') && opts?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (url.includes('exchange-guides')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ guides: { binance: 'old guide' } }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ exchanges: makeRows() }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminExchanges />);
    await waitFor(() => expect(screen.getByText('Binance')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Binance'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Текст подсказки...')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Текст подсказки...');
    fireEvent.change(textarea, { target: { value: 'new guide text' } });

    const saveBtn = screen.getByText('Сохранить гайд');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText(/сохранён/)).toBeInTheDocument();
    });
  });

  it('shows external docs link for exchange with docsUrl', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('exchange-guides')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ guides: {} }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ exchanges: makeRows() }) });
      }),
    );

    render(<AdminExchanges />);
    await waitFor(() => expect(screen.getByText('Binance')).toBeInTheDocument());

    const link = screen.getByTitle('Открыть страницу управления API ключами');
    expect(link).toHaveAttribute('href', 'https://binance.com/api-docs');
  });
});
