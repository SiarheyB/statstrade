import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import SyncProvider, { useSync } from '@/components/SyncProvider';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  }),
}));

function Consumer() {
  const sync = useSync();
  return (
    <div>
      <div data-testid="anySyncing">{String(sync.anySyncing)}</div>
      <div data-testid="notice">{sync.notice ?? ''}</div>
      <button onClick={() => sync.syncAccount('acc1')}>sync-one</button>
      <button onClick={() => sync.syncAll()}>sync-all</button>
      <button onClick={() => sync.setNotice(null)}>clear-notice</button>
    </div>
  );
}

describe('SyncProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws when useSync used outside provider', () => {
    const BadConsumer = () => {
      useSync();
      return null;
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<BadConsumer />)).toThrow('useSync must be used within <SyncProvider>');
    spy.mockRestore();
  });

  it('provides default context values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));

    render(
      <SyncProvider>
        <Consumer />
      </SyncProvider>,
    );

    expect(screen.getByTestId('anySyncing').textContent).toBe('false');
    expect(screen.getByTestId('notice').textContent).toBe('');
  });

  it('runs syncAccount through completion and sets a notice', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/accounts') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.includes('/sync')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'done', imported: 5, total: 10 }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SyncProvider>
        <Consumer />
      </SyncProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('sync-one'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('notice').textContent).toContain('acc.notice.scanned');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/accounts/acc1/sync',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sets error notice when sync fails', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/accounts') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.includes('/sync')) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'boom' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SyncProvider>
        <Consumer />
      </SyncProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('sync-one'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('notice').textContent).toBe('boom');
    });
  });

  it('syncAll fetches accounts and syncs non-mt accounts', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/accounts') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: 'a1', source: 'exchange', autoSync: false, syncIntervalMinutes: 30, syncStatus: 'idle', lastSyncAt: null },
              { id: 'a2', source: 'mt5', autoSync: false, syncIntervalMinutes: 30, syncStatus: 'idle', lastSyncAt: null },
            ]),
        });
      }
      if (url.includes('/sync')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'done', imported: 1, total: 1 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SyncProvider>
        <Consumer />
      </SyncProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText('sync-all'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/accounts/a1/sync', expect.anything());
    });
    // mt5 account must never be synced
    expect(fetchMock).not.toHaveBeenCalledWith('/api/accounts/a2/sync', expect.anything());
  });

  it('scheduler tick starts due auto-syncs on mount', async () => {
    vi.useRealTimers();
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/accounts') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: 'a1', source: 'exchange', autoSync: true, syncIntervalMinutes: 1, syncStatus: 'idle', lastSyncAt: null },
            ]),
        });
      }
      if (url.includes('/sync')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'done', imported: 0, total: 0 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SyncProvider>
        <Consumer />
      </SyncProvider>,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/accounts/a1/sync', expect.anything());
    });
  });
});

// Импорт отчёта живёт в провайдере (а не на странице счетов) ради того, чтобы
// загрузка переживала уход на другую страницу дашборда. Прогресс отправки
// берётся из XMLHttpRequest — fetch его не отдаёт.
describe('SyncProvider — импорт отчёта', () => {
  class FakeXhr {
    static last: FakeXhr | null = null;
    upload = { onprogress: null as ((e: ProgressEvent) => void) | null, onload: null as (() => void) | null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 200;
    responseText = '{"imported":3,"skipped":1}';
    open = vi.fn();
    send = vi.fn();
    constructor() {
      FakeXhr.last = this;
    }
  }

  function ImportConsumer() {
    const sync = useSync();
    const prog = sync.importing['acc1'];
    return (
      <div>
        <div data-testid="phase">{prog?.phase ?? 'idle'}</div>
        <div data-testid="loaded">{prog ? `${prog.loaded}/${prog.total}` : ''}</div>
        <div data-testid="notice">{sync.notice ?? ''}</div>
        <button onClick={() => void sync.importReport('acc1', new File(['x'.repeat(10)], 'r.html'))}>
          import
        </button>
      </div>
    );
  }

  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr as unknown as typeof XMLHttpRequest);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeXhr.last = null;
  });

  it('reports upload progress, then the server-side processing phase', async () => {
    render(
      <SyncProvider>
        <ImportConsumer />
      </SyncProvider>,
    );

    fireEvent.click(screen.getByText('import'));
    await waitFor(() => expect(FakeXhr.last?.send).toHaveBeenCalled());
    expect(screen.getByTestId('phase')).toHaveTextContent('upload');

    act(() => {
      FakeXhr.last!.upload.onprogress!({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
    });
    expect(screen.getByTestId('loaded')).toHaveTextContent('5/10');

    // Файл ушёл — дальше сервер разбирает отчёт, процент неизвестен.
    act(() => FakeXhr.last!.upload.onload!());
    expect(screen.getByTestId('phase')).toHaveTextContent('processing');

    act(() => FakeXhr.last!.onload!());
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('idle'));
    expect(screen.getByTestId('notice')).toHaveTextContent('acc.mt.imported');
  });

  it('surfaces the server error and clears the progress', async () => {
    render(
      <SyncProvider>
        <ImportConsumer />
      </SyncProvider>,
    );
    fireEvent.click(screen.getByText('import'));
    await waitFor(() => expect(FakeXhr.last?.send).toHaveBeenCalled());

    FakeXhr.last!.status = 400;
    FakeXhr.last!.responseText = '{"error":"В файле не найдено закрытых сделок"}';
    act(() => FakeXhr.last!.onload!());

    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('idle'));
    expect(screen.getByTestId('notice')).toHaveTextContent('В файле не найдено закрытых сделок');
  });

  it('ignores a second import for the same account while one is running', async () => {
    render(
      <SyncProvider>
        <ImportConsumer />
      </SyncProvider>,
    );
    fireEvent.click(screen.getByText('import'));
    await waitFor(() => expect(FakeXhr.last?.send).toHaveBeenCalled());
    const first = FakeXhr.last;

    fireEvent.click(screen.getByText('import'));
    expect(FakeXhr.last).toBe(first);
  });
});
